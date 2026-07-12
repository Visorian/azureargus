import { BlockList, isIP } from "node:net";

import { AddressNotFoundError, Reader, type ReaderModel } from "@maxmind/geoip2-node";

interface CountryRecord {
  country?: {
    isoCode?: string;
  };
  registeredCountry?: {
    isoCode?: string;
  };
}

export interface IpCountryReader {
  country(ip: string): CountryRecord;
}

interface IpCountryLookupOptions {
  onInitializationError?: (message: string) => void;
  openReader?: (databasePath: string) => Promise<IpCountryReader>;
}

const nonPublicIpv4Addresses = new BlockList();
const nonPublicIpv6Addresses = new BlockList();
const publicIpv4Exceptions = new Set(["192.0.0.9", "192.0.0.10"]);

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.2", 32],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublicIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  nonPublicIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export class IpCountryLookupUnavailableError extends Error {
  constructor() {
    super("IP country lookup is unavailable");
    this.name = "IpCountryLookupUnavailableError";
  }
}

function normalizeCountryCode(value: string | undefined) {
  const countryCode = value?.trim().toUpperCase();
  return countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
}

function isPublicIp(ip: string) {
  const family = isIP(ip);
  if (family === 4) {
    if (publicIpv4Exceptions.has(ip)) {
      return true;
    }
    return !nonPublicIpv4Addresses.check(ip, "ipv4");
  }
  if (family === 6) {
    return !nonPublicIpv6Addresses.check(ip, "ipv6");
  }
  return false;
}

export function createIpCountryLookup({
  onInitializationError = (message) => console.error(message),
  openReader = (databasePath) => Reader.open(databasePath) as Promise<ReaderModel>,
}: IpCountryLookupOptions = {}) {
  let readerPromise: Promise<IpCountryReader> | null = null;
  let initializationErrorReported = false;

  function reportUnavailable() {
    if (initializationErrorReported) {
      return;
    }
    initializationErrorReported = true;
    onInitializationError("IP country database could not be opened.");
  }

  async function getReader(databasePath: string) {
    if (!databasePath) {
      throw new IpCountryLookupUnavailableError();
    }

    readerPromise ??= openReader(databasePath).catch(() => {
      reportUnavailable();
      throw new IpCountryLookupUnavailableError();
    });

    return readerPromise;
  }

  async function lookup(ip: string, databasePath: string) {
    if (ip !== ip.trim() || !isPublicIp(ip)) {
      return null;
    }

    const reader = await getReader(databasePath);
    try {
      return normalizeCountryCode(reader.country(ip).country?.isoCode);
    } catch (error) {
      if (error instanceof AddressNotFoundError) {
        return null;
      }
      reportUnavailable();
      throw new IpCountryLookupUnavailableError();
    }
  }

  return { lookup };
}

export const ipCountryLookup = createIpCountryLookup();
