targetScope = 'resourceGroup'

@description('Azure region for the Event Hubs namespace.')
param location string

@description('Name of the Event Hubs namespace.')
param eventHubNamespaceName string

@description('Name of the Event Hub created for Azure Argus.')
param eventHubName string

@description('Number of hours that Event Hub records are retained.')
param eventHubRetentionHours int

resource eventHubNamespace 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: eventHubNamespaceName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
    capacity: 1
  }
  properties: {
    disableLocalAuth: false
    isAutoInflateEnabled: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    zoneRedundant: false
  }
}

resource eventHub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  name: eventHubName
  parent: eventHubNamespace
  properties: {
    partitionCount: 1
    retentionDescription: {
      cleanupPolicy: 'Delete'
      retentionTimeInHours: eventHubRetentionHours
    }
    status: 'Active'
  }
}

resource diagnosticAuthorizationRule 'Microsoft.EventHub/namespaces/authorizationRules@2024-01-01' existing = {
  name: 'RootManageSharedAccessKey'
  parent: eventHubNamespace
}

resource listenerAuthorizationRule 'Microsoft.EventHub/namespaces/eventhubs/authorizationRules@2024-01-01' = {
  name: 'azureargus-listen'
  parent: eventHub
  properties: {
    rights: [
      'Listen'
    ]
  }
}

output eventHubNamespaceName string = eventHubNamespace.name
output eventHubNamespaceResourceId string = eventHubNamespace.id
output eventHubName string = eventHub.name
output eventHubResourceId string = eventHub.id
output diagnosticAuthorizationRuleResourceId string = diagnosticAuthorizationRule.id
output listenerAuthorizationRuleName string = listenerAuthorizationRule.name
output listenerAuthorizationRuleResourceId string = listenerAuthorizationRule.id
