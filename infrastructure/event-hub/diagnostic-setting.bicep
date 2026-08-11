targetScope = 'resourceGroup'

@description('Name of the existing Azure Firewall.')
param firewallName string

@description('Name of the Azure Firewall diagnostic setting.')
param diagnosticSettingName string

@description('Resource ID of the namespace authorization rule used by Azure Monitor.')
param eventHubAuthorizationRuleId string

@description('Name of the Event Hub that receives Azure Firewall records.')
param eventHubName string

resource firewall 'Microsoft.Network/azureFirewalls@2024-07-01' existing = {
  name: firewallName
}

resource diagnosticSetting 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: diagnosticSettingName
  scope: firewall
  properties: {
    eventHubAuthorizationRuleId: eventHubAuthorizationRuleId
    eventHubName: eventHubName
    logs: [
      {
        category: 'AZFWNetworkRule'
        enabled: true
      }
      {
        category: 'AZFWApplicationRule'
        enabled: true
      }
      {
        category: 'AZFWNatRule'
        enabled: true
      }
    ]
  }
}

output diagnosticSettingResourceId string = diagnosticSetting.id
