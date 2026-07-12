import {
  isIpCountryLookupRequest,
  isIpCountryLookupResponse,
  MAX_IP_COUNTRY_BATCH_SIZE,
} from "../../shared/types/ipCountry";

describe("IP country contract", () => {
  it("accepts a bounded exact request shape", () => {
    expect(isIpCountryLookupRequest({ ips: ["8.8.8.8", "example.com"] })).toBe(true);
    expect(isIpCountryLookupRequest({ ips: [], extra: true })).toBe(false);
    expect(
      isIpCountryLookupRequest({ ips: Array(MAX_IP_COUNTRY_BATCH_SIZE + 1).fill("8.8.8.8") }),
    ).toBe(false);
    expect(isIpCountryLookupRequest({ ips: ["x".repeat(46)] })).toBe(false);
    expect(isIpCountryLookupRequest({ ips: [1] })).toBe(false);
  });

  it("validates exact bounded response shapes", () => {
    expect(isIpCountryLookupResponse({ results: [{ ip: "8.8.8.8", countryCode: "US" }] })).toBe(
      true,
    );
    expect(isIpCountryLookupResponse({})).toBe(false);
    expect(
      isIpCountryLookupResponse({ results: [{ ip: "8.8.8.8", countryCode: "US", extra: true }] }),
    ).toBe(false);
    expect(isIpCountryLookupResponse({ results: [{ ip: 1, countryCode: null }] })).toBe(false);
    expect(
      isIpCountryLookupResponse({
        results: [
          { ip: "8.8.8.8", countryCode: "DE" },
          { ip: "8.8.8.8", countryCode: "US" },
        ],
      }),
    ).toBe(false);
    expect(
      isIpCountryLookupResponse({
        results: Array(MAX_IP_COUNTRY_BATCH_SIZE + 1).fill({ ip: "8.8.8.8", countryCode: null }),
      }),
    ).toBe(false);
  });
});
