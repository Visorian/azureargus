export class LogAnalyticsConfigurationError extends Error {
  constructor() {
    super('Log Analytics server configuration is incomplete')
    this.name = 'LogAnalyticsConfigurationError'
  }
}
