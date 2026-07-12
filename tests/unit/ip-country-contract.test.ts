import { isIpCountryLookupRequest, MAX_IP_COUNTRY_BATCH_SIZE } from "../../shared/types/ipCountry";

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
});
