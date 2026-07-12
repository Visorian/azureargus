import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { createEvent, type H3Event } from "h3";

import {
  ipCountryLookup,
  IpCountryLookupUnavailableError,
} from "../../server/utils/ipCountryLookup";

vi.mock("../../server/utils/ipCountryLookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/ipCountryLookup")>()),
  ipCountryLookup: { lookup: vi.fn() },
}));

let handler: (event: H3Event) => Promise<unknown>;

function createTestEvent(body: unknown) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const payload = JSON.stringify(body);
  request.method = "POST";
  request.headers["content-length"] = String(Buffer.byteLength(payload));
  request.headers["content-type"] = "application/json";
  request.push(payload);
  request.push(null);
  return createEvent(request, response);
}

beforeAll(async () => {
  vi.stubGlobal("defineEventHandler", <T>(eventHandler: T) => eventHandler);
  vi.stubGlobal("useRuntimeConfig", () => ({
    ipCountry: { databasePath: "/var/lib/geoip/dbip-country-lite.mmdb" },
  }));
  handler = (await import("../../server/api/ip-country.post")).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.mocked(ipCountryLookup.lookup).mockReset().mockResolvedValue(null);
});

describe("IP country route", () => {
  it("serves anonymous bounded lookups and preserves first-seen order", async () => {
    vi.mocked(ipCountryLookup.lookup).mockImplementation(async (ip) =>
      ip === "8.8.8.8" ? "US" : null,
    );

    await expect(
      handler(createTestEvent({ ips: ["8.8.8.8", "10.0.0.1", "example.com", "8.8.8.8"] })),
    ).resolves.toEqual({
      results: [
        { ip: "8.8.8.8", countryCode: "US" },
        { ip: "10.0.0.1", countryCode: null },
        { ip: "example.com", countryCode: null },
      ],
    });
    expect(ipCountryLookup.lookup).toHaveBeenCalledTimes(3);
  });

  it("accepts exactly 32 unique inputs", async () => {
    const ips = Array.from({ length: 32 }, (_, index) => `8.8.8.${index}`);

    await expect(handler(createTestEvent({ ips }))).resolves.toEqual({
      results: ips.map((ip) => ({ ip, countryCode: null })),
    });
    expect(ipCountryLookup.lookup).toHaveBeenCalledTimes(32);
  });

  it("rejects malformed request bodies before lookup", async () => {
    await expect(
      handler(createTestEvent({ ips: ["8.8.8.8"], databasePath: "/caller/path" })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(ipCountryLookup.lookup).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies before buffering lookup work", async () => {
    await expect(handler(createTestEvent({ ips: ["x".repeat(2_100)] }))).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(ipCountryLookup.lookup).not.toHaveBeenCalled();
  });

  it("returns sanitized 503 when database is unavailable", async () => {
    vi.mocked(ipCountryLookup.lookup).mockRejectedValueOnce(new IpCountryLookupUnavailableError());

    await expect(handler(createTestEvent({ ips: ["8.8.8.8"] }))).rejects.toMatchObject({
      statusCode: 503,
      message: "IP country lookup is unavailable",
    });
  });
});
