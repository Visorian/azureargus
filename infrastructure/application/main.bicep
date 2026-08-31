targetScope = 'resourceGroup'

@description('Optional. Azure region for the Container Apps resources.')
param location string = resourceGroup().location

@description('Optional. Multitenant Entra application client ID used for temporary Log Analytics access.')
param delegatedClientId string = ''

@minLength(5)
@maxLength(70)
@description('Optional. Stable Azure Argus container version in X.Y.Z form.')
param targetVersion string = '0.4.2'

@description('Optional. Immutable Azure Argus image reference for the hosted deployment.')
param targetImage string = ''

@description('Optional. Managed Environment name. A deployment-specific name is generated when empty.')
param managedEnvironmentName string = ''

@description('Optional. Container App name. A deployment-specific name is generated when empty.')
param applicationName string = ''

@description('Optional. Custom hostname. Leave empty during initial DNS bootstrap.')
param customDomainName string = ''

var containerImage = empty(targetImage)
  ? 'ghcr.io/visorian/azureargus:${targetVersion}'
  : targetImage
var resourceSuffix = uniqueString(subscription().id, resourceGroup().id)
var resolvedEnvironmentName = empty(managedEnvironmentName)
  ? 'azureargus-env-${resourceSuffix}'
  : managedEnvironmentName
var resolvedApplicationName = empty(applicationName) ? 'azureargus-${resourceSuffix}' : applicationName

module environment 'br/public:avm/res/app/managed-environment:0.15.0' = {
  name: 'azureargus-environment'
  params: {
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    enableTelemetry: false
    location: location
    name: resolvedEnvironmentName
    publicNetworkAccess: 'Enabled'
    zoneRedundant: false
  }
}

module application 'br/public:avm/res/app/container-app:0.23.0' = {
  name: 'azureargus-application'
  params: {
    activeRevisionsMode: 'Single'
    containers: [
      {
        env: empty(delegatedClientId)
          ? []
          : [
              {
                name: 'NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID'
                value: delegatedClientId
              }
            ]
        image: containerImage
        name: 'azureargus'
        probes: [
          {
            failureThreshold: 30
            httpGet: {
              path: '/api/capabilities'
              port: 3000
            }
            initialDelaySeconds: 1
            periodSeconds: 2
            timeoutSeconds: 2
            type: 'Startup'
          }
          {
            failureThreshold: 3
            httpGet: {
              path: '/api/capabilities'
              port: 3000
            }
            periodSeconds: 10
            timeoutSeconds: 2
            type: 'Liveness'
          }
          {
            failureThreshold: 3
            httpGet: {
              path: '/api/capabilities'
              port: 3000
            }
            periodSeconds: 5
            timeoutSeconds: 2
            type: 'Readiness'
          }
        ]
        resources: {
          cpu: json('0.25')
          memory: '0.5Gi'
        }
      }
    ]
    customDomains: empty(customDomainName)
      ? null
      : [
          {
            bindingType: 'Auto'
            name: customDomainName
          }
        ]
    enableTelemetry: false
    environmentResourceId: environment.outputs.resourceId
    ingressAllowInsecure: false
    ingressExternal: true
    ingressTargetPort: 3000
    ingressTransport: 'auto'
    location: location
    name: resolvedApplicationName
    scaleSettings: {
      maxReplicas: 1
      minReplicas: 0
    }
  }
}

output applicationName string = application.outputs.name
output applicationResourceId string = application.outputs.resourceId
output applicationUrl string = 'https://${application.outputs.fqdn}'
output environmentName string = environment.outputs.name
output environmentResourceId string = environment.outputs.resourceId
