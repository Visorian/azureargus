export const MAX_IP_COUNTRY_BATCH_SIZE = 32;
export const MAX_IP_COUNTRY_REQUEST_BYTES = 2_048;
export const MAX_IP_COUNTRY_VALUE_LENGTH = 45;

export interface IpCountryLookupRequest {
  ips: string[];
}

export interface IpCountryLookupResult {
  ip: string;
  countryCode: string | null;
}

export interface IpCountryLookupResponse {
  results: IpCountryLookupResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIpCountryLookupRequest(value: unknown): value is IpCountryLookupRequest {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.ips)) {
    return false;
  }

  return (
    value.ips.length <= MAX_IP_COUNTRY_BATCH_SIZE &&
    value.ips.every((ip) => typeof ip === "string" && ip.length <= MAX_IP_COUNTRY_VALUE_LENGTH)
  );
}

export function isIpCountryLookupResponse(value: unknown): value is IpCountryLookupResponse {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.results)) {
    return false;
  }

  if (value.results.length > MAX_IP_COUNTRY_BATCH_SIZE) {
    return false;
  }

  const seenIps = new Set<string>();
  for (const result of value.results) {
    if (
      !isRecord(result) ||
      Object.keys(result).length !== 2 ||
      typeof result.ip !== "string" ||
      result.ip.length > MAX_IP_COUNTRY_VALUE_LENGTH ||
      (result.countryCode !== null && typeof result.countryCode !== "string") ||
      seenIps.has(result.ip)
    ) {
      return false;
    }
    seenIps.add(result.ip);
  }

  return true;
}
