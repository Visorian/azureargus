import type { SimulatorTraffic } from '../../shared/types/firewallSimulator'
import {
  buildFirewallProcessingPlan,
  exportFirewallSnapshot,
  normalizeFirewallSnapshot,
  parseFirewallSnapshot,
  simulateFirewallTraffic,
} from '../../shared/utils/firewallSimulator'

const rootId =
  '/subscriptions/test/resourceGroups/firewall/providers/Microsoft.Network/firewallPolicies/base'
const childId =
  '/subscriptions/test/resourceGroups/firewall/providers/Microsoft.Network/firewallPolicies/child'
const siblingId =
  '/subscriptions/test/resourceGroups/firewall/providers/Microsoft.Network/firewallPolicies/sibling'
const ipGroupId =
  '/subscriptions/test/resourceGroups/firewall/providers/Microsoft.Network/ipGroups/clients'
const traffic: SimulatorTraffic = {
  applicationProtocol: 'Https',
  destinationIp: '203.0.113.10',
  destinationPort: '443',
  direction: 'outbound',
  protocol: 'TCP',
  sourceIp: '10.0.0.8',
  targetFqdn: 'api.example.com',
}

function networkRule(name = 'network', overrides: Record<string, unknown> = {}) {
  return {
    name,
    ruleType: 'NetworkRule',
    sourceAddresses: ['10.0.0.0/24'],
    destinationAddresses: ['203.0.113.10'],
    destinationPorts: ['443'],
    ipProtocols: ['TCP'],
    ...overrides,
  }
}

function applicationRule(name = 'application', overrides: Record<string, unknown> = {}) {
  return {
    name,
    ruleType: 'ApplicationRule',
    sourceAddresses: ['*'],
    targetFqdns: ['*.example.com'],
    protocols: [{ protocolType: 'Https', port: 443 }],
    ...overrides,
  }
}

function collection(
  name: string,
  priority: number,
  rules: Record<string, unknown>[],
  action = 'Allow',
) {
  return { name, priority, rules, action: { type: action } }
}

function group(name: string, priority: number, ruleCollections: Record<string, unknown>[]) {
  return { name, priority, ruleCollections }
}

function policy(id: string, groups: Record<string, unknown>[], basePolicyId?: string) {
  return {
    id,
    name: id.slice(id.lastIndexOf('/') + 1),
    type: 'Microsoft.Network/firewallPolicies',
    basePolicy: basePolicyId === undefined ? undefined : { id: basePolicyId },
    ruleCollectionGroups: groups,
    threatIntelMode: 'Off',
  }
}

function evaluate(
  resources: unknown,
  targetTraffic: SimulatorTraffic = traffic,
  selectedPolicyId = rootId,
) {
  const snapshot = normalizeFirewallSnapshot(resources)
  return simulateFirewallTraffic(
    snapshot,
    buildFirewallProcessingPlan(snapshot, selectedPolicyId),
    targetTraffic,
  )
}

describe('firewall policy imports and processing order', () => {
  it('combines pasted CLI and REST documents and roundtrips them as ARM resources', () => {
    const rawPolicy = {
      ...policy(rootId, []),
      ruleCollectionGroups: [{ id: `${rootId}/ruleCollectionGroups/egress` }],
    }
    const rawGroup = {
      id: `${rootId}/ruleCollectionGroups/egress`,
      name: 'egress',
      type: 'Microsoft.Network/firewallPolicies/ruleCollectionGroups',
      properties: group('egress', 100, [
        collection('allow-clients', 100, [
          networkRule('group-rule', {
            sourceAddresses: [],
            sourceIpGroups: [ipGroupId.toUpperCase()],
          }),
        ]),
      ]),
    }
    const rawIpGroup = {
      id: ipGroupId,
      name: 'clients',
      type: 'Microsoft.Network/ipGroups',
      properties: { ipAddresses: ['10.0.0.8-10.0.0.12'] },
    }
    const snapshot = parseFirewallSnapshot(
      `${JSON.stringify(rawPolicy)}\n${JSON.stringify({ value: [rawGroup] })}\n${JSON.stringify([rawIpGroup])}`,
    )
    const plan = buildFirewallProcessingPlan(snapshot, rootId.toUpperCase())

    expect(plan.complete).toBe(true)
    expect(plan.incompleteReasons).toStrictEqual([])
    expect(plan.collections[0]?.inherited).toBe(false)
    expect(simulateFirewallTraffic(snapshot, plan, traffic).verdict).toBe('Allow')
    const reimported = parseFirewallSnapshot(JSON.stringify(exportFirewallSnapshot(snapshot)))
    expect(reimported.ipGroups).toStrictEqual(snapshot.ipGroups)
    expect(
      simulateFirewallTraffic(reimported, buildFirewallProcessingPlan(reimported, rootId), traffic)
        .verdict,
    ).toBe('Allow')
  })

  it('associates nested and fully qualified ARM template group names', () => {
    const snapshot = normalizeFirewallSnapshot({
      resources: [
        {
          type: 'Microsoft.Network/firewallPolicies',
          name: 'base',
          properties: { threatIntelMode: 'Off' },
          resources: [
            {
              type: 'ruleCollectionGroups',
              name: 'nested',
              properties: group('nested', 200, [collection('nested-allow', 100, [networkRule()])]),
            },
          ],
        },
        {
          type: 'Microsoft.Network/firewallPolicies/ruleCollectionGroups',
          name: 'base/other',
          properties: group('other', 300, [collection('other-allow', 100, [networkRule()])]),
        },
      ],
    })
    const plan = buildFirewallProcessingPlan(snapshot, 'Microsoft.Network/firewallPolicies/base')
    expect(plan.complete).toBe(false)
    expect(plan.collections.map((item) => item.name)).toStrictEqual(['nested-allow', 'other-allow'])
    expect(
      simulateFirewallTraffic(snapshot, plan, { ...traffic, applicationProtocol: 'None' }).verdict,
    ).toBe('Indeterminate')
  })

  it('orders type before ancestry, group before collection, and excludes sibling and inherited DNAT collections', () => {
    const nat = {
      ...networkRule('translate'),
      ruleType: 'NatRule',
      translatedAddress: '10.1.0.5',
      translatedPort: '443',
    }
    const snapshot = normalizeFirewallSnapshot({
      policies: [
        policy(rootId, [
          group('base-low', 600, [
            collection('base-network', 800, [networkRule()]),
            collection('base-app', 100, [applicationRule()]),
            collection('base-nat', 500, [nat], 'Dnat'),
          ]),
          group('base-high', 100, [collection('base-network-first', 500, [networkRule()])]),
        ]),
        policy(
          childId,
          [
            group('child-low', 200, [collection('child-second', 100, [networkRule()])]),
            group('child-high', 100, [
              collection('child-third', 500, [networkRule()]),
              collection('child-first', 200, [networkRule()]),
              collection('child-nat', 100, [nat], 'Dnat'),
            ]),
          ],
          rootId,
        ),
        policy(
          siblingId,
          [group('sibling', 100, [collection('sibling-network', 100, [networkRule()])])],
          rootId,
        ),
      ],
    })
    const plan = buildFirewallProcessingPlan(snapshot, childId)
    expect(plan.collections.map((item) => item.name)).toStrictEqual([
      'child-nat',
      'base-network-first',
      'base-network',
      'child-first',
      'child-third',
      'child-second',
      'base-app',
    ])
    expect(plan.warnings).toContain(
      'DNAT collection base-nat in base is not inherited by a child policy.',
    )
    expect(plan.policyChain.map((item) => item.id)).toStrictEqual([rootId, childId])
  })

  it('marks a missing ancestor indeterminate when the selected policy has a complete group list', () => {
    const snapshot = normalizeFirewallSnapshot(policy(childId, [], rootId))
    const plan = buildFirewallProcessingPlan(snapshot, childId)
    expect(plan.complete).toBe(false)
    expect(plan.incompleteReasons).toStrictEqual([
      expect.stringContaining(`Base policy ${rootId} is missing.`),
    ])
    const result = simulateFirewallTraffic(snapshot, plan, {
      ...traffic,
      applicationProtocol: 'None',
    })
    expect(result).toMatchObject({
      cause: 'incomplete-policy',
      verdict: 'Indeterminate',
    })
    expect(result.summary).toContain(`Base policy ${rootId} is missing.`)
  })

  it('preserves missing collection group references through export without a missing ancestor', () => {
    const snapshot = normalizeFirewallSnapshot(
      policy(rootId, [{ id: `${rootId}/ruleCollectionGroups/missing` }]),
    )
    const reimported = parseFirewallSnapshot(JSON.stringify(exportFirewallSnapshot(snapshot)))
    for (const current of [snapshot, reimported]) {
      const plan = buildFirewallProcessingPlan(current, rootId)
      expect(plan.complete).toBe(false)
      expect(plan.incompleteReasons).toStrictEqual([
        expect.stringContaining('Collection groups for base are incomplete.'),
      ])
      const result = simulateFirewallTraffic(current, plan, {
        ...traffic,
        applicationProtocol: 'None',
      })
      expect(result).toMatchObject({
        cause: 'incomplete-policy',
        verdict: 'Indeterminate',
      })
      expect(result.summary).toContain('Collection groups for base are incomplete.')
    }
  })

  it('keeps standalone groups indeterminate without a complete policy group list, including after export', () => {
    const snapshot = normalizeFirewallSnapshot([
      {
        id: rootId,
        name: 'base',
        type: 'Microsoft.Network/firewallPolicies',
        properties: { threatIntelMode: 'Off' },
      },
      {
        id: `${rootId}/ruleCollectionGroups/allow-only`,
        ...group('allow-only', 200, [collection('allow', 100, [networkRule()])]),
      },
    ])
    const reimported = parseFirewallSnapshot(JSON.stringify(exportFirewallSnapshot(snapshot)))
    for (const current of [snapshot, reimported]) {
      const plan = buildFirewallProcessingPlan(current, rootId)
      const result = simulateFirewallTraffic(current, plan, {
        ...traffic,
        applicationProtocol: 'None',
      })
      expect(result).toMatchObject({
        cause: 'incomplete-policy',
        verdict: 'Indeterminate',
      })
      expect(result.summary).toContain('Collection groups for base are incomplete.')
      expect(plan.complete).toBe(false)
    }
  })

  it('marks nested base policies indeterminate, matching the Azure hierarchy constraint', () => {
    const grandchildId = `${childId}-nested`
    const snapshot = normalizeFirewallSnapshot([
      policy(rootId, []),
      policy(childId, [], rootId),
      policy(
        grandchildId,
        [group('allow', 100, [collection('allow', 100, [networkRule()])])],
        childId,
      ),
    ])
    const plan = buildFirewallProcessingPlan(snapshot, grandchildId)
    expect(plan.complete).toBe(false)
    expect(plan.incompleteReasons).toStrictEqual([expect.stringContaining('nests base policies')])
    expect(plan.warnings.join(' ')).toContain('nests base policies')
    const result = simulateFirewallTraffic(snapshot, plan, traffic)
    expect(result).toMatchObject({
      cause: 'incomplete-policy',
      verdict: 'Indeterminate',
    })
    expect(result.summary).toContain('nests base policies')
  })

  it('rejects ambiguous imports and invalid rules and detects inheritance cycles', () => {
    expect(() => parseFirewallSnapshot('Name Priority\nbase 100')).toThrow('Expected JSON')
    expect(() => parseFirewallSnapshot('{"policies":[')).toThrow('Incomplete JSON')
    expect(() =>
      normalizeFirewallSnapshot(
        policy(rootId, [group('invalid', 100, [collection('bad', 99, [networkRule()])])]),
      ),
    ).toThrow('priority')
    expect(() =>
      normalizeFirewallSnapshot(
        policy(rootId, [
          group('invalid', 100, [collection('mixed', 100, [networkRule(), applicationRule()])]),
        ]),
      ),
    ).toThrow('single supported rule type')
    expect(() =>
      normalizeFirewallSnapshot(
        policy(rootId, [
          group('invalid', 100, [
            {
              ...collection('unsupported', 100, [
                networkRule('new-type', { ruleType: 'UnknownRule' }),
              ]),
              ruleType: 'Network',
            },
          ]),
        ]),
      ),
    ).toThrow('unsupported ruleType')
    const snapshot = normalizeFirewallSnapshot([
      policy(rootId, [], childId),
      policy(childId, [], rootId),
    ])
    const plan = buildFirewallProcessingPlan(snapshot, childId)
    expect(plan.complete).toBe(false)
    expect(plan.incompleteReasons).toStrictEqual([expect.stringContaining('cycle')])
    expect(plan.warnings.join(' ')).toContain('cycle')
  })
})

describe('firewall traffic simulation', () => {
  it('stops at the first matching network deny before later rules and application allow', () => {
    const result = evaluate(
      policy(rootId, [
        group('egress', 100, [
          collection('application-first-numerically', 100, [applicationRule()]),
          collection(
            'deny',
            200,
            [networkRule('miss', { destinationPorts: ['22'] }), networkRule('hit')],
            'Deny',
          ),
          collection('allow-later', 300, [networkRule()]),
        ]),
      ]),
    )
    expect(result.verdict).toBe('Deny')
    expect(result.cause).toBe('rule-match')
    expect(result.trace.map((entry) => [entry.ruleName, entry.status])).toStrictEqual([
      ['miss', 'no-match'],
      ['hit', 'match'],
    ])
  })

  it('resolves CIDR, range and IP-group address conditions with port ranges', () => {
    const result = evaluate({
      policies: [
        policy(rootId, [
          group('egress', 100, [
            collection('allow', 100, [
              networkRule('ip-group', {
                sourceAddresses: [],
                sourceIpGroups: [ipGroupId],
                destinationAddresses: ['203.0.113.0/24'],
                destinationPorts: ['440-450'],
              }),
            ]),
          ]),
        ]),
      ],
      ipGroups: [{ id: ipGroupId, ipAddresses: ['10.0.0.8-10.0.0.10'] }],
    })
    expect(result.verdict).toBe('Allow')
    expect(result.trace[0]?.ruleName).toBe('ip-group')
  })

  it('skips rules referencing an empty IP group, but keeps missing groups indeterminate', () => {
    const rawPolicy = policy(rootId, [
      group('egress', 100, [
        collection(
          'guard',
          100,
          [networkRule('group', { sourceAddresses: [], sourceIpGroups: [ipGroupId] })],
          'Deny',
        ),
        collection('fallback', 200, [networkRule()]),
      ]),
    ])
    const empty = evaluate({
      policies: [rawPolicy],
      ipGroups: [{ id: ipGroupId, ipAddresses: [] }],
    })
    expect(empty.verdict).toBe('Allow')
    expect(empty.trace[0]?.status).toBe('skipped')
    const missingSnapshot = normalizeFirewallSnapshot(rawPolicy)
    const missingPlan = buildFirewallProcessingPlan(missingSnapshot, rootId)
    expect(missingPlan.complete).toBe(true)
    expect(missingPlan.missingIpGroupIds).toStrictEqual([ipGroupId])
    const missing = simulateFirewallTraffic(missingSnapshot, missingPlan, traffic)
    expect(missing.verdict).toBe('Indeterminate')
    expect(missing.cause).toBe('unresolved-rule')
    expect(missing.summary).toContain('guard / group')
    expect(missing.summary).toContain('Source IP group clients is missing')
    expect(missing.trace.map((entry) => entry.status)).toStrictEqual(['unknown', 'match'])
    const earlierMatch = evaluate(
      policy(rootId, [
        group('egress', 100, [
          collection('first', 100, [networkRule()]),
          collection('unreached', 200, [networkRule('group', { sourceIpGroups: [ipGroupId] })]),
        ]),
      ]),
    )
    expect(earlierMatch.verdict).toBe('Allow')
    expect(earlierMatch.trace.map((entry) => entry.ruleName)).toStrictEqual(['network'])
  })

  it('terminates DNAT with a translated endpoint before network filtering', () => {
    const nat = {
      ...networkRule('publish'),
      ruleType: 'NatRule',
      translatedAddress: '10.1.0.5',
      translatedPort: '8443',
    }
    const result = evaluate(
      policy(rootId, [
        group('inbound', 100, [
          collection('network-deny', 100, [networkRule()], 'Deny'),
          collection('publish', 200, [nat], 'Dnat'),
        ]),
      ]),
      { ...traffic, direction: 'inbound' },
    )
    expect(result.verdict).toBe('DNAT')
    expect(result.translation).toBe('10.1.0.5:8443')
    expect(result.trace).toHaveLength(1)
  })

  it('matches application protocol, port and suffix wildcards while skipping inbound application evaluation', () => {
    const resource = policy(rootId, [
      group('egress', 100, [
        collection('https', 100, [applicationRule('site', { targetFqdns: ['*example.com'] })]),
      ]),
    ])
    expect(evaluate(resource, { ...traffic, targetFqdn: 'myexample.com' }).verdict).toBe('Allow')
    const inbound = evaluate(resource, { ...traffic, direction: 'inbound' })
    expect(inbound.verdict).toBe('Deny')
    expect(inbound.trace[0]?.status).toBe('skipped')
    const noApplication = evaluate(resource, { ...traffic, applicationProtocol: 'None' })
    expect(noApplication.verdict).toBe('Deny')
    expect(noApplication.trace[0]?.status).toBe('skipped')
    expect(noApplication.summary).toContain('Application rules were not evaluated')
    expect(() => evaluate(resource, { ...traffic, targetFqdn: '' })).toThrow(
      'Enter the HTTP Host, HTTPS SNI, or MSSQL target FQDN',
    )
  })

  it.each([
    {
      name: 'application destination addresses',
      rule: applicationRule('restricted', { destinationAddresses: ['192.0.2.1'] }),
    },
    {
      name: 'application IP-only target',
      rule: applicationRule('restricted', { destinationAddresses: ['192.0.2.1'], targetFqdns: [] }),
    },
    {
      name: 'network source geography',
      rule: networkRule('restricted', { sourceGeoLocations: ['US'] }),
    },
    {
      name: 'network destination geography',
      rule: networkRule('restricted', { destinationGeoLocations: ['CA'] }),
    },
    {
      name: 'network Kubernetes source',
      rule: networkRule('restricted', {
        sourceAddresses: [],
        sourceKubeSelectorGroups: ['/selector-groups/clients'],
      }),
    },
    {
      name: 'application Kubernetes source',
      rule: applicationRule('restricted', {
        sourceAddresses: [],
        sourceKubeSelectorGroups: ['/selector-groups/clients'],
      }),
    },
  ])('does not ignore unmodeled $name', ({ rule }) => {
    const result = evaluate(
      policy(rootId, [group('restricted', 100, [collection('restricted', 100, [rule])])]),
    )
    expect(result.verdict).toBe('Indeterminate')
    expect(result.trace[0]?.status).toBe('unknown')
  })

  it('does not treat an Any rule with explicit ports as matching ICMP', () => {
    const resource = policy(rootId, [
      group('egress', 100, [
        collection('any-port', 100, [
          networkRule('any', { ipProtocols: ['Any'], destinationPorts: ['443'] }),
        ]),
      ]),
    ])
    expect(
      evaluate(resource, {
        ...traffic,
        applicationProtocol: 'None',
        protocol: 'ICMP',
        destinationPort: '',
      }).verdict,
    ).toBe('Deny')
    expect(
      evaluate(resource, { ...traffic, applicationProtocol: 'None', protocol: 'UDP' }).verdict,
    ).toBe('Allow')
    expect(
      evaluate(
        policy(rootId, [
          group('egress', 100, [
            collection('icmp', 100, [
              networkRule('icmp', { ipProtocols: ['ICMP'], destinationPorts: ['*'] }),
            ]),
          ]),
        ]),
        { ...traffic, protocol: 'ICMP', applicationProtocol: 'None', destinationPort: '' },
      ).verdict,
    ).toBe('Allow')
  })

  it('preserves dynamic destination uncertainty before later definitive matches', () => {
    const resource = policy(rootId, [
      group('egress', 100, [
        collection('service-tag', 100, [
          networkRule('tag', { destinationAddresses: ['AzureCloud'] }),
        ]),
        collection('deny', 200, [networkRule()], 'Deny'),
      ]),
    ])
    const result = evaluate(resource)
    expect(result.verdict).toBe('Indeterminate')
    expect(result.trace[0]?.reason).toContain('service tag')
    const networkDns = policy(rootId, [
      group('egress', 100, [
        collection('dns', 100, [
          networkRule('dns', { destinationAddresses: [], destinationFqdns: ['api.example.com'] }),
        ]),
      ]),
    ])
    const unresolvedDns = evaluate(networkDns, { ...traffic, applicationProtocol: 'None' })
    expect(unresolvedDns.verdict).toBe('Indeterminate')
    expect(unresolvedDns.cause).toBe('unresolved-rule')
    expect(unresolvedDns.summary).toContain('Network FQDN rules depend on the firewall DNS cache.')
    expect(unresolvedDns.trace[0]?.status).toBe('unknown')
  })

  it('reports external inspection and infrastructure limits without inventing an application default deny', () => {
    const resource = {
      ...policy(rootId, []),
      threatIntelMode: 'Deny',
      intrusionDetection: { mode: 'Deny' },
      transportSecurity: { certificateAuthority: { name: 'ca' } },
    }
    const result = evaluate(resource)
    expect(result.verdict).toBe('Indeterminate')
    expect(result.cause).toBe('infrastructure')
    expect(result.summary).toContain('No configured rule matches.')
    expect(result.summary).toContain('built-in infrastructure collection')
    expect(result.warnings.join(' ')).toContain('threat intelligence Deny runs before')
    expect(result.warnings.join(' ')).toContain('IDPS Deny')
    expect(result.warnings.join(' ')).toContain('built-in infrastructure')
    expect(
      evaluate(resource, { ...traffic, protocol: 'UDP', applicationProtocol: 'None' }),
    ).toMatchObject({ verdict: 'Deny', cause: 'default-deny' })
  })

  it('rejects invalid concrete flow addresses and ports', () => {
    const resource = policy(rootId, [])
    expect(() => evaluate(resource, { ...traffic, sourceIp: '999.0.0.1' })).toThrow('valid IPv4')
    expect(() => evaluate(resource, { ...traffic, destinationPort: '65536' })).toThrow(
      'destination port',
    )
  })
})
