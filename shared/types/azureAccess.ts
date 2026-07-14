export interface AzureAccessibleTenant {
  tenantId: string;
  displayName: string;
  defaultDomain: string | null;
}

export interface AzureAccessibleWorkspace {
  workspaceId: string;
  name: string;
  subscriptionId: string;
  subscriptionName: string;
  resourceGroup: string;
  location: string;
}

export interface AzureLogAnalyticsAccess {
  tenants: AzureAccessibleTenant[];
  workspaces: AzureAccessibleWorkspace[];
}
