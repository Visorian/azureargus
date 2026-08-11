targetScope = 'resourceGroup'

@description('Name of the existing Azure Firewall.')
param firewallName string

resource firewall 'Microsoft.Network/azureFirewalls@2024-07-01' existing = {
  name: firewallName
}

output location string = firewall.location
