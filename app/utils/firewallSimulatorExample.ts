import type { FirewallExport, SimulatorTraffic } from '#shared/types/firewallSimulator'

export const FIREWALL_SIMULATOR_EXAMPLE_TRAFFIC: SimulatorTraffic = {
  sourceIp: '10.20.0.10',
  destinationIp: '10.30.0.4',
  destinationPort: '443',
  protocol: 'TCP',
  applicationProtocol: 'None',
  targetFqdn: '',
  direction: 'outbound',
}

const scope =
  '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/example/providers/Microsoft.Network'
const base = `${scope}/firewallPolicies/organization`
const child = `${scope}/firewallPolicies/workload`
const sibling = `${scope}/firewallPolicies/restricted-workload`
const clients = `${scope}/ipGroups/workload-clients`
const servers = `${scope}/ipGroups/private-services`

export const FIREWALL_SIMULATOR_EXAMPLE: FirewallExport = {
  resources: [
    {
      id: clients,
      name: 'workload-clients',
      type: 'Microsoft.Network/ipGroups',
      properties: { ipAddresses: ['10.20.0.0/24'] },
    },
    {
      id: servers,
      name: 'private-services',
      type: 'Microsoft.Network/ipGroups',
      properties: { ipAddresses: ['10.30.0.4', '10.30.1.0-10.30.1.15'] },
    },
    {
      id: base,
      name: 'organization',
      type: 'Microsoft.Network/firewallPolicies',
      properties: {
        threatIntelMode: 'Alert',
        ruleCollectionGroups: [{ id: `${base}/ruleCollectionGroups/organization-rules` }],
      },
    },
    {
      id: child,
      name: 'workload',
      type: 'Microsoft.Network/firewallPolicies',
      properties: {
        basePolicy: { id: base },
        threatIntelMode: 'Alert',
        ruleCollectionGroups: [{ id: `${child}/ruleCollectionGroups/workload-rules` }],
      },
    },
    {
      id: sibling,
      name: 'restricted-workload',
      type: 'Microsoft.Network/firewallPolicies',
      properties: {
        basePolicy: { id: base },
        threatIntelMode: 'Alert',
        ruleCollectionGroups: [{ id: `${sibling}/ruleCollectionGroups/restricted-rules` }],
      },
    },
    {
      id: `${base}/ruleCollectionGroups/organization-rules`,
      name: 'organization-rules',
      type: 'Microsoft.Network/firewallPolicies/ruleCollectionGroups',
      properties: {
        priority: 500,
        ruleCollections: [
          {
            name: 'block-ssh',
            priority: 500,
            ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
            action: { type: 'Deny' },
            rules: [
              {
                name: 'deny-ssh',
                ruleType: 'NetworkRule',
                sourceAddresses: ['*'],
                destinationAddresses: ['*'],
                destinationPorts: ['22'],
                ipProtocols: ['TCP'],
              },
            ],
          },
          {
            name: 'block-domain',
            priority: 100,
            ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
            action: { type: 'Deny' },
            rules: [
              {
                name: 'deny-blocked-domain',
                ruleType: 'ApplicationRule',
                sourceAddresses: ['*'],
                protocols: [{ protocolType: 'Https', port: 443 }],
                targetFqdns: ['blocked.example.com'],
              },
            ],
          },
        ],
      },
    },
    {
      id: `${child}/ruleCollectionGroups/workload-rules`,
      name: 'workload-rules',
      type: 'Microsoft.Network/firewallPolicies/ruleCollectionGroups',
      properties: {
        priority: 100,
        ruleCollections: [
          {
            name: 'publish-service',
            priority: 600,
            ruleCollectionType: 'FirewallPolicyNatRuleCollection',
            action: { type: 'DNAT' },
            rules: [
              {
                name: 'https-inbound',
                ruleType: 'NatRule',
                sourceAddresses: ['198.51.100.0/24'],
                destinationAddresses: ['203.0.113.10'],
                destinationPorts: ['443'],
                ipProtocols: ['TCP'],
                translatedAddress: '10.30.0.4',
                translatedPort: '8443',
              },
            ],
          },
          {
            name: 'private-https',
            priority: 200,
            ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
            action: { type: 'Allow' },
            rules: [
              {
                name: 'allow-private-service',
                ruleType: 'NetworkRule',
                sourceIpGroups: [clients],
                destinationIpGroups: [servers],
                destinationPorts: ['443'],
                ipProtocols: ['TCP'],
              },
            ],
          },
          {
            name: 'public-https',
            priority: 100,
            ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
            action: { type: 'Allow' },
            rules: [
              {
                name: 'allow-example-subdomains',
                ruleType: 'ApplicationRule',
                sourceIpGroups: [clients],
                protocols: [{ protocolType: 'Https', port: 443 }],
                targetFqdns: ['*.example.com'],
              },
            ],
          },
        ],
      },
    },
    {
      id: `${sibling}/ruleCollectionGroups/restricted-rules`,
      name: 'restricted-rules',
      type: 'Microsoft.Network/firewallPolicies/ruleCollectionGroups',
      properties: {
        priority: 100,
        ruleCollections: [
          {
            name: 'deny-private-https',
            priority: 100,
            ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
            action: { type: 'Deny' },
            rules: [
              {
                name: 'deny-private-service',
                ruleType: 'NetworkRule',
                sourceIpGroups: [clients],
                destinationIpGroups: [servers],
                destinationPorts: ['443'],
                ipProtocols: ['TCP'],
              },
            ],
          },
        ],
      },
    },
  ],
}
