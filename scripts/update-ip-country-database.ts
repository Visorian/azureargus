import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { Reader } from "@maxmind/geoip2-node";

export const MAX_COMPRESSED_BYTES = 16 * 1024 * 1024;
export const MAX_DATABASE_BYTES = 32 * 1024 * 1024;
const DEFAULT_PIN_PATH = fileURLToPath(new URL("./dbip-country-lite.pin.json", import.meta.url));
const RELEASE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface DatabasePin {
  archiveSha256: string;
  release: string;
}

interface FileOperations {
  mkdir: typeof mkdir;
  rename: typeof rename;
  rm: typeof rm;
  writeFile: typeof writeFile;
}

interface UpdateIpCountryDatabaseOptions {
  databasePath?: string;
  fetcher?: typeof fetch;
  fileOperations?: FileOperations;
  maxCompressedBytes?: number;
  maxDatabaseBytes?: number;
  pinPath?: string;
  validateDatabase?: (database: Buffer) => void;
}

function parsePin(value: unknown): DatabasePin {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("DB-IP Country Lite pin must be an object");
  }

  const { archiveSha256, release } = value as Record<string, unknown>;
  if (typeof release !== "string" || !RELEASE_PATTERN.test(release)) {
    throw new Error("DB-IP Country Lite pin release must use YYYY-MM");
  }
  if (typeof archiveSha256 !== "string" || !SHA256_PATTERN.test(archiveSha256)) {
    throw new Error("DB-IP Country Lite pin archiveSha256 must be lowercase SHA-256");
  }

  return { archiveSha256, release };
}

async function readPin(pinPath: string) {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(pinPath, "utf8"));
  } catch (error) {
    throw new Error("DB-IP Country Lite pin could not be read", { cause: error });
  }
  return parsePin(value);
}

export async function updateIpCountryDatabase({
  databasePath = resolve(
    process.env.NUXT_IP_COUNTRY_DATABASE_PATH || ".data/dbip-country-lite.mmdb",
  ),
  fetcher = fetch,
  fileOperations = { mkdir, rename, rm, writeFile },
  maxCompressedBytes = MAX_COMPRESSED_BYTES,
  maxDatabaseBytes = MAX_DATABASE_BYTES,
  pinPath = DEFAULT_PIN_PATH,
  validateDatabase = (database) => {
    Reader.openBuffer(database).country("1.1.1.1");
  },
}: UpdateIpCountryDatabaseOptions = {}) {
  const temporaryPath = `${databasePath}.${process.pid}.tmp`;
  const pin = await readPin(pinPath);
  const databaseUrl = `https://download.db-ip.com/free/dbip-country-lite-${pin.release}.mmdb.gz`;

  try {
    const response = await fetcher(databaseUrl);
    if (!response.ok) {
      throw new Error(`DB-IP Country Lite download failed with HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("DB-IP Country Lite download returned no body");
    }

    const chunks: Uint8Array[] = [];
    let compressedSize = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      compressedSize += value.byteLength;
      if (compressedSize > maxCompressedBytes) {
        await reader.cancel();
        throw new Error("DB-IP Country Lite download exceeds expected size");
      }
      chunks.push(value);
    }

    const compressed = Buffer.concat(chunks, compressedSize);
    const archiveSha256 = createHash("sha256").update(compressed).digest("hex");
    if (archiveSha256 !== pin.archiveSha256) {
      throw new Error("DB-IP Country Lite archive checksum does not match pin");
    }
    const database = gunzipSync(compressed, { maxOutputLength: maxDatabaseBytes });
    validateDatabase(database);

    await fileOperations.mkdir(dirname(databasePath), { recursive: true });
    await fileOperations.writeFile(temporaryPath, database, { mode: 0o600 });
    await fileOperations.rename(temporaryPath, databasePath);
  } catch (error) {
    await fileOperations.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return pin.release;
}

if (import.meta.main) {
  const release = await updateIpCountryDatabase();
  console.log(`Updated DB-IP Country Lite database for ${release}.`);
}
