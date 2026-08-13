targetScope = 'resourceGroup'

@description('Optional. Multitenant Entra application client ID used for temporary Log Analytics access.')
param delegatedClientId string = ''

var containerImage = 'ghcr.io/visorian/azureargus@sha256:d2acc8a74cfa71e8b1503403f26348d82aba0a52a547a5a2c7bc55e3d7f8e387'
var resourceSuffix = uniqueString(subscription().id, resourceGroup().id)
var environmentName = 'azureargus-env-${resourceSuffix}'
var applicationName = 'azureargus-${resourceSuffix}'

module environment 'br/public:avm/res/app/managed-environment:0.15.0' = {
  name: 'azureargus-environment'
  params: {
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    enableTelemetry: false
    name: environmentName
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
    enableTelemetry: false
    environmentResourceId: environment.outputs.resourceId
    ingressAllowInsecure: false
    ingressExternal: true
    ingressTargetPort: 3000
    ingressTransport: 'auto'
    name: applicationName
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
