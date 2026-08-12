targetScope = 'resourceGroup'

@description('Name of the Event Hub created for Azure Argus.')
@minLength(1)
@maxLength(256)
param eventHubName string = 'azureargus'

@description('Number of hours that Event Hub records are retained.')
@minValue(1)
@maxValue(168)
param eventHubRetentionHours int = 1

var eventHubNamespaceName = 'azureargus-${uniqueString(subscription().id, resourceGroup().id, eventHubName)}'

module eventHubResources './event-hub.bicep' = {
  name: 'azureargus-event-hub-${uniqueString(deployment().name, eventHubNamespaceName, eventHubName)}'
  params: {
    eventHubName: eventHubName
    eventHubNamespaceName: eventHubNamespaceName
    eventHubRetentionHours: eventHubRetentionHours
    location: resourceGroup().location
  }
}

output eventHubNamespaceName string = eventHubResources.outputs.eventHubNamespaceName
output eventHubNamespaceResourceId string = eventHubResources.outputs.eventHubNamespaceResourceId
output eventHubName string = eventHubResources.outputs.eventHubName
output eventHubResourceId string = eventHubResources.outputs.eventHubResourceId
output listenerAuthorizationRuleName string = eventHubResources.outputs.listenerAuthorizationRuleName
output listenerAuthorizationRuleResourceId string = eventHubResources.outputs.listenerAuthorizationRuleResourceId
