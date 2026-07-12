import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { Reader } from "@maxmind/geoip2-node";

import { updateIpCountryDatabase } from "../../scripts/update-ip-country-database";

const fixturePath = new URL("../fixtures/GeoLite2-Country-Test.mmdb", import.meta.url);

function responseWithBody(body: Uint8Array) {
  return new Response(body, { status: 200 });
}

describe("IP country database updater", () => {
  let directory: string;
  let databasePath: string;
  let fixture: Buffer;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "azureargus-geoip-"));
    databasePath = join(directory, "country.mmdb");
    fixture = await readFile(fixturePath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("streams, validates, and atomically replaces the database", async () => {
    const operations: string[] = [];

    await updateIpCountryDatabase({
      databasePath,
      fetcher: async () => responseWithBody(gzipSync(fixture)),
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
      validateDatabase: (database) => {
        Reader.openBuffer(database).country("81.2.69.142");
      },
    });

    expect(operations).toEqual(["write", "rename"]);
    expect(await readFile(databasePath)).toEqual(fixture);
    expect(
      Reader.openBuffer(await readFile(databasePath)).country("81.2.69.142").country.isoCode,
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

    await expect(
      updateIpCountryDatabase({
        databasePath,
        fetcher: async () => new Response(body),
        maxCompressedBytes: 5,
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

    await expect(
      updateIpCountryDatabase({
        databasePath,
        fetcher: async () => responseWithBody(responseBody),
      }),
    ).rejects.toThrow();
    expect(await readFile(databasePath)).toEqual(previous);
  });
});
