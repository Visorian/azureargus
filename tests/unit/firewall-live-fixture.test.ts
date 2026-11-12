import { readFileSync } from 'node:fs'

import type { SimulatorTraffic } from '../../shared/types/firewallSimulator'
import {
  buildFirewallProcessingPlan,
  parseFirewallSnapshot,
  simulateFirewallTraffic,
} from '../../shared/utils/firewallSimulator'

const fixtureText = readFileSync(
  new URL('../fixtures/firewall/azure-policy-hierarchy.sanitized.json', import.meta.url),
  'utf8',
)
const snapshot = parseFirewallSnapshot(fixtureText)
const scope =
  '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/firewall-fixture/providers/Microsoft.Network/firewallPolicies'
const traffic: SimulatorTraffic = {
  sourceIp: '10.20.0.10',
  destinationIp: '10.30.0.4',
  destinationPort: '443',
  protocol: 'TCP',
  applicationProtocol: 'None',
  targetFqdn: '',
  direction: 'outbound',
}

it('builds the selected parent and child from actual ARM responses without including siblings', () => {
  const plan = buildFirewallProcessingPlan(snapshot, `${scope}/workload`)
  expect(plan.complete).toBe(true)
  expect(plan.policyChain.map((policy) => policy.name)).toStrictEqual(['base', 'workload'])
  expect(plan.collections.map((collection) => collection.name)).toStrictEqual([
    'workload-publish-service',
    'base-block-smtp',
    'base-block-ssh',
    'workload-empty-group',
    'workload-private-https',
    'base-block-domain',
    'workload-public-https',
  ])
  const siblingPlan = buildFirewallProcessingPlan(snapshot, `${scope}/sibling`)
  const siblingResult = simulateFirewallTraffic(snapshot, siblingPlan, traffic)
  expect(siblingResult.verdict).toBe('Deny')
  expect(siblingResult.summary).toContain('sibling-deny-https / sibling-deny-private-https')
})

it.each([
  {
    name: 'inclusive source range and destination CIDR',
    policy: 'workload',
    sourceIp: '10.21.0.10',
    destinationIp: '10.30.1.7',
    destinationPort: '443',
    collection: 'workload-private-https',
  },
  {
    name: 'another child with its own source IP group',
    policy: 'regional',
    sourceIp: '10.40.0.10',
    destinationIp: '10.30.0.4',
    destinationPort: '8443',
    collection: 'regional-monitoring',
  },
])('resolves actual IP groups for $name', (testCase) => {
  const plan = buildFirewallProcessingPlan(snapshot, `${scope}/${testCase.policy}`)
  const result = simulateFirewallTraffic(snapshot, plan, {
    ...traffic,
    sourceIp: testCase.sourceIp,
    destinationIp: testCase.destinationIp,
    destinationPort: testCase.destinationPort,
  })
  expect(result.verdict).toBe('Allow')
  expect(result.summary).toContain(testCase.collection)
})

it('imports actual flattened Azure CLI projections as adjacent JSON documents', () => {
  const fixture: unknown = JSON.parse(fixtureText)
  if (
    typeof fixture !== 'object' ||
    fixture === null ||
    !('cliResources' in fixture) ||
    !Array.isArray(fixture.cliResources)
  ) {
    throw new TypeError('Captured CLI resources are missing')
  }
  const cliText = fixture.cliResources
    .map((resource: unknown) => JSON.stringify(resource))
    .join('\n')
  const imported = parseFirewallSnapshot(cliText)
  const plan = buildFirewallProcessingPlan(imported, `${scope}/workload`)
  expect(plan.complete).toBe(true)
  expect(plan.policyChain.map((policy) => policy.name)).toStrictEqual(['base', 'workload'])
  const result = simulateFirewallTraffic(imported, plan, traffic)
  expect(result.verdict).toBe('Allow')
  expect(result.summary).toContain('workload-private-https / workload-allow-private-https')
  expect(
    result.trace.find((entry) => entry.ruleName === 'workload-skip-empty-clients')?.status,
  ).toBe('skipped')
})
