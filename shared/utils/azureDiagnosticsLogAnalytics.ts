export const AZURE_DIAGNOSTICS_NETWORK_PROJECTION = `AzureDiagnostics
| where ResourceProvider =~ "MICROSOFT.NETWORK"
| where ResourceType =~ "AZUREFIREWALLS"
| where Category == "AZFWNetworkRule"
| project
    TimeGenerated,
    Category = "AZFWNetworkRule",
    ResourceId = tostring(_ResourceId),
    Action = tostring(column_ifexists("Action_s", "")),
    ActionReason = tostring(column_ifexists("ActionReason_s", "")),
    Protocol = tostring(column_ifexists("Protocol_s", "")),
    SourceIp = tostring(column_ifexists("SourceIP", "")),
    SourcePort = tostring(column_ifexists("SourcePort_d", real(null))),
    DestinationIp = tostring(column_ifexists("DestinationIp_s", "")),
    DestinationFqdn = "",
    DestinationPort = tostring(column_ifexists("DestinationPort_d", real(null))),
    Policy = tostring(column_ifexists("Policy_s", "")),
    RuleCollectionGroup = tostring(column_ifexists("RuleCollectionGroup_s", "")),
    RuleCollection = tostring(column_ifexists("RuleCollection_s", "")),
    Rule = tostring(column_ifexists("Rule_s", ""))`;
