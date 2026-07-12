import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { Reader } from "@maxmind/geoip2-node";

export const MAX_COMPRESSED_BYTES = 16 * 1024 * 1024;
export const MAX_DATABASE_BYTES = 32 * 1024 * 1024;

interface FileOperations {
  mkdir: typeof mkdir;
  rename: typeof rename;
  rm: typeof rm;
  writeFile: typeof writeFile;
}

interface UpdateIpCountryDatabaseOptions {
  databasePath?: string;
  databaseUrl?: string;
  fetcher?: typeof fetch;
  fileOperations?: FileOperations;
  maxCompressedBytes?: number;
  maxDatabaseBytes?: number;
  validateDatabase?: (database: Buffer) => void;
}

function currentRelease() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function updateIpCountryDatabase({
  databasePath = resolve(
    process.env.NUXT_IP_COUNTRY_DATABASE_PATH || ".data/dbip-country-lite.mmdb",
  ),
  databaseUrl = `https://download.db-ip.com/free/dbip-country-lite-${currentRelease()}.mmdb.gz`,
  fetcher = fetch,
  fileOperations = { mkdir, rename, rm, writeFile },
  maxCompressedBytes = MAX_COMPRESSED_BYTES,
  maxDatabaseBytes = MAX_DATABASE_BYTES,
  validateDatabase = (database) => {
    Reader.openBuffer(database).country("1.1.1.1");
  },
}: UpdateIpCountryDatabaseOptions = {}) {
  const temporaryPath = `${databasePath}.${process.pid}.tmp`;

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
    const database = gunzipSync(compressed, { maxOutputLength: maxDatabaseBytes });
    validateDatabase(database);

    await fileOperations.mkdir(dirname(databasePath), { recursive: true });
    await fileOperations.writeFile(temporaryPath, database, { mode: 0o600 });
    await fileOperations.rename(temporaryPath, databasePath);
  } catch (error) {
    await fileOperations.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

if (import.meta.main) {
  await updateIpCountryDatabase();
  console.log(`Updated DB-IP Country Lite database for ${currentRelease()}.`);
}
