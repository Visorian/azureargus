import { AddressNotFoundError } from "@maxmind/geoip2-node";

import {
  createIpCountryLookup,
  IpCountryLookupUnavailableError,
  type IpCountryReader,
} from "../../server/utils/ipCountryLookup";

function createReader(countryCode = "DE"): IpCountryReader {
  return {
    country: () => ({ country: { isoCode: countryCode } }),
  };
}

describe("IP country lookup", () => {
  it("reuses one reader and returns normalized country codes", async () => {
    const openReader = vi.fn().mockResolvedValue(createReader(" de "));
    const lookup = createIpCountryLookup({ openReader });

    await expect(lookup.lookup("8.8.8.8", "/geo.mmdb")).resolves.toBe("DE");
    await expect(lookup.lookup("1.1.1.1", "/geo.mmdb")).resolves.toBe("DE");
    expect(openReader).toHaveBeenCalledOnce();
  });

  it.each([
    "",
    "example.com",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "192.0.2.1",
    "192.88.99.2",
    "::1",
    "64:ff9b:1::1",
    "100:0:0:1::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2001:10::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
    "::ffff:8.8.8.8",
    " 8.8.8.8 ",
  ])("does not query nonpublic destination %s", async (ip) => {
    const reader = createReader();
    const country = vi.spyOn(reader, "country");
    const lookup = createIpCountryLookup({ openReader: async () => reader });

    await expect(lookup.lookup(ip, "/geo.mmdb")).resolves.toBeNull();
    expect(country).not.toHaveBeenCalled();
  });

  it.each(["192.0.0.9", "192.0.0.10", "64:ff9b::808:808"])(
    "allows globally reachable special-purpose destination %s",
    async (ip) => {
      const reader = createReader();
      const country = vi.spyOn(reader, "country");
      const lookup = createIpCountryLookup({ openReader: async () => reader });

      await expect(lookup.lookup(ip, "/geo.mmdb")).resolves.toBe("DE");
      expect(country).toHaveBeenCalledWith(ip);
    },
  );

  it("returns null for addresses missing from database", async () => {
    const reader: IpCountryReader = {
      country: () => {
        throw new AddressNotFoundError("missing");
      },
    };
    const lookup = createIpCountryLookup({ openReader: async () => reader });

    await expect(lookup.lookup("8.8.8.8", "/geo.mmdb")).resolves.toBeNull();
  });

  it("does not substitute registered country", async () => {
    const reader: IpCountryReader = {
      country: () => ({ registeredCountry: { isoCode: "US" } }),
    };
    const lookup = createIpCountryLookup({ openReader: async () => reader });

    await expect(lookup.lookup("8.8.8.8", "/geo.mmdb")).resolves.toBeNull();
  });

  it("reports database initialization failure once", async () => {
    const onInitializationError = vi.fn();
    const lookup = createIpCountryLookup({
      onInitializationError,
      openReader: async () => {
        throw new Error("filesystem path must stay private");
      },
    });

    await expect(lookup.lookup("8.8.8.8", "/secret/path.mmdb")).rejects.toBeInstanceOf(
      IpCountryLookupUnavailableError,
    );
    await expect(lookup.lookup("1.1.1.1", "/secret/path.mmdb")).rejects.toBeInstanceOf(
      IpCountryLookupUnavailableError,
    );
    expect(onInitializationError).toHaveBeenCalledOnce();
    expect(onInitializationError).toHaveBeenCalledWith("IP country database could not be opened.");
  });
});
