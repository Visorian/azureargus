using './main.bicep'

param location = 'germanywestcentral'
param delegatedClientId = readEnvironmentVariable('AZUREARGUS_DELEGATED_CLIENT_ID')
param targetVersion = '0.3.0' // x-release-please-version
param managedEnvironmentName = 'azureargus-env-gwc'
param applicationName = 'azureargus-gwc'
param customDomainName = 'azureargus.vsrn.cc'
