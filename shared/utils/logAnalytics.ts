export const DEFAULT_LOG_ANALYTICS_QUERY_LIMIT = 1_000;
export const MIN_LOG_ANALYTICS_QUERY_LIMIT = 100;
export const MAX_LOG_ANALYTICS_QUERY_LIMIT = 5_000;

export function isLogAnalyticsQueryLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_LOG_ANALYTICS_QUERY_LIMIT &&
    value <= MAX_LOG_ANALYTICS_QUERY_LIMIT
  );
}
