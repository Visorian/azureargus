targetScope = 'resourceGroup'

@description('Name of the Event Hub created for Azure Argus.')
@minLength(1)
@maxLength(256)
param eventHubName string = 'azureargus'

@description('Number of hours that Event Hub records are retained.')
@minValue(1)
@maxValue(168)
param eventHubRetentionHours int = 1

@description('Deploy the Azure Firewall diagnostic setting that forwards logs to the Event Hub.')
param deployFirewallDiagnosticSetting bool = true

@description('Name of the resource group containing the existing Azure Firewall. Leave empty to use the deployment resource group. Ignored when the firewall diagnostic setting is not deployed.')
@maxLength(90)
param firewallResourceGroupName string = ''

@description('Name of the existing Azure Firewall. Required when deploying the firewall diagnostic setting and ignored otherwise.')
@maxLength(56)
param firewallName string = ''

var eventHubNamespaceName = 'azureargus-${uniqueString(subscription().id, resourceGroup().id, eventHubName)}'
var eventHubResourceId = resourceId('Microsoft.EventHub/namespaces/eventhubs', eventHubNamespaceName, eventHubName)
var effectiveFirewallResourceGroupName = empty(firewallResourceGroupName)
  ? resourceGroup().name
  : firewallResourceGroupName
var firewallResourceGroupScope = resourceGroup(effectiveFirewallResourceGroupName)
var diagnosticSettingName = 'azureargus-forwarding-${uniqueString(eventHubResourceId)}'
var diagnosticDeploymentName = 'azureargus-firewall-diagnostic-${uniqueString(deployment().name, subscription().id, effectiveFirewallResourceGroupName, firewallName, eventHubResourceId)}'

module firewallDetails './firewall.bicep' = if (deployFirewallDiagnosticSetting) {
  name: 'azureargus-firewall-${uniqueString(deployment().name, subscription().id, effectiveFirewallResourceGroupName, firewallName, eventHubResourceId)}'
  scope: firewallResourceGroupScope
  params: {
    firewallName: firewallName
  }
}

module eventHubResources './event-hub.bicep' = {
  name: 'azureargus-event-hub-${uniqueString(deployment().name, eventHubNamespaceName, eventHubName)}'
  params: {
    eventHubName: eventHubName
    eventHubNamespaceName: eventHubNamespaceName
    eventHubRetentionHours: eventHubRetentionHours
    location: firewallDetails.?outputs.location ?? resourceGroup().location
  }
}

module firewallDiagnosticSetting './diagnostic-setting.bicep' = if (deployFirewallDiagnosticSetting) {
  name: diagnosticDeploymentName
  scope: firewallResourceGroupScope
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
output diagnosticSettingName string = deployFirewallDiagnosticSetting ? diagnosticSettingName : ''
output diagnosticSettingResourceId string = firewallDiagnosticSetting.?outputs.diagnosticSettingResourceId ?? ''
