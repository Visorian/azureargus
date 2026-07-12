import {
  countryCodeToFlag,
  countryCodeToName,
  normalizeCountryCode,
} from "../../app/utils/countryFlag";

describe("country flags", () => {
  it("normalizes ISO country codes and builds regional-indicator flags", () => {
    expect(normalizeCountryCode(" de ")).toBe("DE");
    expect(countryCodeToFlag("DE")).toBe("🇩🇪");
    expect(countryCodeToFlag("invalid")).toBe("");
  });

  it("returns localized country names and falls back for invalid locale data", () => {
    expect(countryCodeToName("DE", "en")).toBe("Germany");
    expect(countryCodeToName("invalid", "en")).toBe("");
  });
});
