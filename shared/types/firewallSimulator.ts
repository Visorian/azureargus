export type FirewallJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FirewallJsonValue[]
  | FirewallJsonObject

export interface FirewallJsonObject {
  [field: string]: FirewallJsonValue
}

export type SimulatorRuleType = 'DNAT' | 'Network' | 'Application'
export type SimulatorAction = 'Allow' | 'Deny' | 'DNAT'

export interface SimulatorRule {
  name: string
  ruleType: SimulatorRuleType
  properties: FirewallJsonObject
}

export interface SimulatorRuleCollection {
  name: string
  priority: number
  ruleType: SimulatorRuleType
  action: SimulatorAction
  rules: SimulatorRule[]
}

export interface SimulatorRuleCollectionGroup {
  name: string
  priority: number
  collections: SimulatorRuleCollection[]
}

export interface SimulatorPolicy {
  id: string
  name: string
  basePolicyId?: string
  groups: SimulatorRuleCollectionGroup[]
  settings: FirewallJsonObject
  groupsComplete: boolean
}

export interface SimulatorIpGroup {
  id: string
  name: string
  addresses: string[]
}

export interface FirewallSnapshot {
  policies: SimulatorPolicy[]
  ipGroups: SimulatorIpGroup[]
  diagnostics: string[]
}

export interface FirewallExport {
  resources: FirewallJsonObject[]
}

export interface ProcessingCollection extends SimulatorRuleCollection {
  id: string
  policyId: string
  policyName: string
  inherited: boolean
  groupName: string
  groupPriority: number
  reason: string
}

export interface FirewallProcessingPlan {
  policyChain: SimulatorPolicy[]
  collections: ProcessingCollection[]
  warnings: string[]
  incompleteReasons: string[]
  missingIpGroupIds: string[]
  complete: boolean
}

export interface SimulatorTraffic {
  sourceIp: string
  destinationIp: string
  destinationPort: string
  protocol: 'TCP' | 'UDP' | 'ICMP'
  applicationProtocol: 'None' | 'Http' | 'Https' | 'Mssql'
  targetFqdn: string
  direction: 'outbound' | 'inbound'
}

export interface FirewallTrafficErrors {
  sourceIp?: string
  destinationIp?: string
  destinationPort?: string
  targetFqdn?: string
}

export interface SimulationTraceEntry {
  collectionId: string
  ruleName: string
  status: 'match' | 'no-match' | 'unknown' | 'skipped'
  reason: string
}

export interface FirewallSimulationResult {
  cause: 'rule-match' | 'incomplete-policy' | 'unresolved-rule' | 'infrastructure' | 'default-deny'
  verdict: SimulatorAction | 'Indeterminate'
  summary: string
  trace: SimulationTraceEntry[]
  warnings: string[]
  translation?: string
}
