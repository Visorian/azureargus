export type DeploymentMode = "anonymous" | "managed" | "invalid";

export type DeploymentConfigurationErrorCode =
  | "delegated_log_analytics_invalid"
  | "event_hub_incomplete"
  | "event_hub_invalid"
  | "log_analytics_incomplete"
  | "log_analytics_invalid"
  | "oidc_incomplete"
  | "oidc_invalid";

export interface DeploymentConfigurationError {
  code: DeploymentConfigurationErrorCode;
  message: string;
}

export interface DeploymentCapabilities {
  mode: DeploymentMode;
  eventHubAvailable: boolean;
  predefinedLogAnalyticsAvailable: boolean;
  temporaryLogAnalyticsAuthAvailable: boolean;
  errors: DeploymentConfigurationError[];
}
