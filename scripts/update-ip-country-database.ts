import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { Reader } from "@maxmind/geoip2-node";

const MAX_COMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_DATABASE_BYTES = 32 * 1024 * 1024;
const now = new Date();
const release = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const databaseUrl = `https://download.db-ip.com/free/dbip-country-lite-${release}.mmdb.gz`;
const databasePath = resolve(
  process.env.NUXT_IP_COUNTRY_DATABASE_PATH || ".data/dbip-country-lite.mmdb",
);
const temporaryPath = `${databasePath}.${process.pid}.tmp`;

const response = await fetch(databaseUrl);
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
  if (compressedSize > MAX_COMPRESSED_BYTES) {
    await reader.cancel();
    throw new Error("DB-IP Country Lite download exceeds expected size");
  }
  chunks.push(value);
}

const compressed = Buffer.concat(chunks, compressedSize);
const database = gunzipSync(compressed, { maxOutputLength: MAX_DATABASE_BYTES });
Reader.openBuffer(database).country("1.1.1.1");

await mkdir(dirname(databasePath), { recursive: true });
await writeFile(temporaryPath, database, { mode: 0o600 });
await rename(temporaryPath, databasePath);
console.log(`Updated DB-IP Country Lite database for ${release}.`);
