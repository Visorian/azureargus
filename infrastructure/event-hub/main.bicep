targetScope = 'resourceGroup'

@description('Name of the resource group containing the existing Azure Firewall.')
@minLength(1)
@maxLength(90)
param firewallResourceGroupName string

@description('Name of the existing Azure Firewall.')
@minLength(1)
@maxLength(56)
param firewallName string

@description('Name of the Event Hub created for Azure Argus.')
@minLength(1)
@maxLength(256)
param eventHubName string = 'azureargus'

@description('Number of hours that Event Hub records are retained.')
@minValue(1)
@maxValue(168)
param eventHubRetentionHours int = 1

var eventHubNamespaceName = 'azureargus-${uniqueString(subscription().id, resourceGroup().id, eventHubName)}'
var eventHubResourceId = resourceId('Microsoft.EventHub/namespaces/eventhubs', eventHubNamespaceName, eventHubName)
var diagnosticSettingName = 'azureargus-${uniqueString(eventHubResourceId)}'

module firewallDetails './firewall.bicep' = {
  name: 'azureargus-firewall-${uniqueString(eventHubResourceId)}'
  scope: resourceGroup(firewallResourceGroupName)
  params: {
    firewallName: firewallName
  }
}

module eventHubResources './event-hub.bicep' = {
  name: 'azureargus-event-hub-${uniqueString(eventHubNamespaceName, eventHubName)}'
  params: {
    eventHubName: eventHubName
    eventHubNamespaceName: eventHubNamespaceName
    eventHubRetentionHours: eventHubRetentionHours
    location: firewallDetails.outputs.location
  }
}

module firewallDiagnosticSetting './diagnostic-setting.bicep' = {
  name: diagnosticSettingName
  scope: resourceGroup(firewallResourceGroupName)
  params: {
    diagnosticSettingName: diagnosticSettingName
    eventHubAuthorizationRuleId: eventHubResources.outputs.diagnosticAuthorizationRuleResourceId
    eventHubName: eventHubName
    firewallName: firewallName
  }
}

output eventHubNamespaceName string = eventHubResources.outputs.eventHubNamespaceName
output eventHubNamespaceResourceId string = eventHubResources.outputs.eventHubNamespaceResourceId
output eventHubName string = eventHubResources.outputs.eventHubName
output eventHubResourceId string = eventHubResources.outputs.eventHubResourceId
output listenerAuthorizationRuleName string = eventHubResources.outputs.listenerAuthorizationRuleName
output listenerAuthorizationRuleResourceId string = eventHubResources.outputs.listenerAuthorizationRuleResourceId
output diagnosticSettingName string = diagnosticSettingName
output diagnosticSettingResourceId string = firewallDiagnosticSetting.outputs.diagnosticSettingResourceId
