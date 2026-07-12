import { createError, getHeader, type H3Event } from "h3";

import {
  isIpCountryLookupRequest,
  MAX_IP_COUNTRY_REQUEST_BYTES,
  type IpCountryLookupRequest,
  type IpCountryLookupResponse,
} from "#shared/types/ipCountry";
import { ipCountryLookup, IpCountryLookupUnavailableError } from "../utils/ipCountryLookup";

async function readRequest(event: H3Event): Promise<IpCountryLookupRequest> {
  const contentLength = Number(getHeader(event, "content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IP_COUNTRY_REQUEST_BYTES) {
    throw createError({ statusCode: 413, message: "Request body is too large" });
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_IP_COUNTRY_REQUEST_BYTES) {
      throw createError({ statusCode: 413, message: "Request body is too large" });
    }
    chunks.push(buffer);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw createError({ statusCode: 400, message: "Invalid request body" });
  }
  if (!isIpCountryLookupRequest(body)) {
    throw createError({ statusCode: 400, message: "Invalid request body" });
  }
  return body;
}

export default defineEventHandler(async (event): Promise<IpCountryLookupResponse> => {
  const body = await readRequest(event);
  const databasePath = useRuntimeConfig(event).ipCountry.databasePath;
  const ips = [...new Set(body.ips)];

  try {
    return {
      results: await Promise.all(
        ips.map(async (ip) => ({
          ip,
          countryCode: await ipCountryLookup.lookup(ip, databasePath),
        })),
      ),
    };
  } catch (error) {
    if (error instanceof IpCountryLookupUnavailableError) {
      throw createError({ statusCode: 503, message: "IP country lookup is unavailable" });
    }
    throw error;
  }
});
