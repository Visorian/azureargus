import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { Reader } from "@maxmind/geoip2-node";

import { updateIpCountryDatabase } from "../../scripts/update-ip-country-database";

const fixturePath = new URL("../fixtures/GeoLite2-Country-Test.mmdb", import.meta.url);

function responseWithBody(body: Uint8Array) {
  return new Response(new Uint8Array(body), { status: 200 });
}

describe("IP country database updater", () => {
  let directory: string;
  let databasePath: string;
  let fixture: Buffer;
  let pinPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "azureargus-geoip-"));
    databasePath = join(directory, "country.mmdb");
    pinPath = join(directory, "pin.json");
    fixture = await readFile(fixturePath);
  });

  async function writePin(archive: Uint8Array, release = "2025-01") {
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    await writeFile(pinPath, JSON.stringify({ release, archiveSha256 }));
  }

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("streams, validates, and atomically replaces the database", async () => {
    const operations: string[] = [];
    const archive = gzipSync(fixture);
    await writePin(archive);

    await updateIpCountryDatabase({
      databasePath,
      fetcher: async () => responseWithBody(archive),
      fileOperations: {
        mkdir,
        rm,
        writeFile: async (...args) => {
          operations.push("write");
          await writeFile(...args);
        },
        rename: async (...args) => {
          operations.push("rename");
          await rename(...args);
        },
      },
      pinPath,
      validateDatabase: (database) => {
        Reader.openBuffer(database).country("81.2.69.142");
      },
    });

    expect(operations).toEqual(["write", "rename"]);
    expect(await readFile(databasePath)).toEqual(fixture);
    expect(
      Reader.openBuffer(await readFile(databasePath)).country("81.2.69.142").country?.isoCode,
    ).toBe("GB");
  });

  it("rejects a response that crosses the compressed size cap", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
      },
      cancel() {
        cancelled = true;
      },
    });
    await writePin(new Uint8Array(6));

    await expect(
      updateIpCountryDatabase({
        databasePath,
        fetcher: async () => new Response(body),
        maxCompressedBytes: 5,
        pinPath,
      }),
    ).rejects.toThrow("download exceeds expected size");
    expect(cancelled).toBe(true);
  });

  it.each([
    ["invalid gzip", Buffer.from("not gzip")],
    ["invalid MMDB", gzipSync("not an mmdb")],
  ])("retains the previous database after %s", async (_name, responseBody) => {
    const previous = Buffer.from("previous database");
    await writeFile(databasePath, previous);
    await writePin(responseBody);

    await expect(
      updateIpCountryDatabase({
        databasePath,
        fetcher: async () => responseWithBody(responseBody),
        pinPath,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(await readFile(databasePath)).toEqual(previous);
  });

  it("rejects a malformed pin before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await writeFile(pinPath, JSON.stringify({ release: "current", archiveSha256: "invalid" }));

    await expect(updateIpCountryDatabase({ databasePath, fetcher, pinPath })).rejects.toThrow(
      "pin release must use YYYY-MM",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the previous database when archive checksum differs", async () => {
    const previous = Buffer.from("previous database");
    const archive = gzipSync(fixture);
    await writeFile(databasePath, previous);
    await writePin(Buffer.from("different archive"));

    await expect(
      updateIpCountryDatabase({
        databasePath,
        fetcher: async () => responseWithBody(archive),
        pinPath,
      }),
    ).rejects.toThrow("archive checksum does not match pin");
    expect(await readFile(databasePath)).toEqual(previous);
  });

  it("selects the pinned URL independently of system date", async () => {
    const archive = gzipSync(fixture);
    const urls: string[] = [];
    await writePin(archive, "2024-02");

    await updateIpCountryDatabase({
      databasePath,
      fetcher: async (input) => {
        if (typeof input !== "string") {
          throw new TypeError("Expected updater to fetch a string URL");
        }
        urls.push(input);
        return responseWithBody(archive);
      },
      pinPath,
      validateDatabase: () => undefined,
    });

    expect(urls).toEqual(["https://download.db-ip.com/free/dbip-country-lite-2024-02.mmdb.gz"]);
  });
});
