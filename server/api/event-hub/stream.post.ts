import { EventHubConsumerClient } from "@azure/event-hubs";
import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";
import { createError, getHeader, getRequestURL, readValidatedBody, setResponseHeaders } from "h3";

import type { ManagedEventHubStreamRequest } from "../../../shared/types/managedEventHub";
import { parseDeploymentCapabilities } from "../../utils/deploymentCapabilities";
import {
  createManagedEventHubStream,
  pipeManagedEventHubStream,
  validateManagedEventHubStreamRequest,
} from "../../utils/managedEventHubStream";

function hasEntityPath(connectionString: string) {
  return connectionString.split(";").some((part) => {
    const separatorIndex = part.indexOf("=");
    return (
      separatorIndex > 0 && part.slice(0, separatorIndex).trim().toLowerCase() === "entitypath"
    );
  });
}

function requireSameOrigin(event: Parameters<typeof getRequestURL>[0]) {
  const requestUrl = getRequestURL(event);
  const origin = getHeader(event, "origin");
  const fetchSite = getHeader(event, "sec-fetch-site");
  if (origin !== requestUrl.origin || (fetchSite && fetchSite !== "same-origin")) {
    throw createError({ statusCode: 403, message: "Cross-origin Event Hub stream is forbidden" });
  }
}

export default defineEventHandler(async (event) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  event.node.req.once("aborted", abort);
  event.node.res.once("close", abort);
  event.web?.request?.signal.addEventListener("abort", abort, { once: true });
  if (
    event.node.req.aborted ||
    event.node.res.destroyed ||
    event.node.res.writableEnded ||
    event.web?.request?.signal.aborted
  ) {
    abort();
  }

  const removeAbortListeners = () => {
    event.node.req.off("aborted", abort);
    event.node.res.off("close", abort);
    event.web?.request?.signal.removeEventListener("abort", abort);
  };
  let client: EventHubConsumerClient | undefined;
  let managedStream: ReturnType<typeof createManagedEventHubStream> | undefined;

  try {
    const session = await requireUserSession(event, { errorBehavior: "throw" });
    const runtimeConfig = useRuntimeConfig(event);
    const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env);
    if (capabilities.mode !== "managed" || !capabilities.eventHubAvailable) {
      throw createError({
        statusCode: capabilities.mode === "invalid" ? 503 : 403,
        message: "Managed Event Hub is unavailable",
      });
    }

    requireSameOrigin(event);
    const request = await readValidatedBody<ManagedEventHubStreamRequest>(event, (body) =>
      validateManagedEventHubStreamRequest(body) ? body : false,
    );
    const connectionString = runtimeConfig.eventHub.connectionString.trim();
    const eventHubName = runtimeConfig.eventHub.name.trim();
    try {
      client =
        eventHubName && !hasEntityPath(connectionString)
          ? new EventHubConsumerClient(request.consumerGroup, connectionString, eventHubName)
          : new EventHubConsumerClient(request.consumerGroup, connectionString);
    } catch {
      throw createError({ statusCode: 502, message: "Managed Event Hub could not start" });
    }
    const sessionExpiresAt =
      typeof session.expireAt === "number" ? session.expireAt : Math.floor(Date.now() / 1_000) + 60;

    let expectedPartitionIds: string[];
    try {
      if (controller.signal.aborted) {
        throw new Error("Managed Event Hub request closed");
      }
      expectedPartitionIds = await client.getPartitionIds({ abortSignal: controller.signal });
      if (expectedPartitionIds.length === 0 || controller.signal.aborted) {
        throw new Error("Managed Event Hub partitions unavailable");
      }
    } catch {
      throw createError({ statusCode: 502, message: "Managed Event Hub could not start" });
    }

    managedStream = createManagedEventHubStream({
      client,
      expectedPartitionIds,
      request,
      sessionExpiresAt,
      signal: controller.signal,
      revalidateSession: async () => {
        try {
          await requireUserSession(event, { errorBehavior: "throw" });
          return true;
        } catch {
          return false;
        }
      },
    });

    setResponseHeaders(event, {
      "cache-control": "no-cache, no-store, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-accel-buffering": "no",
    });

    try {
      event._handled = true;
      await pipeManagedEventHubStream(event.node.res, managedStream.stream);
    } catch {
      if (!event.node.res.destroyed) {
        event.node.res.destroy();
      }
    }
  } finally {
    controller.abort();
    try {
      if (managedStream) {
        await managedStream.cleanup();
      } else if (client) {
        await Promise.allSettled([client.close()]);
      }
    } finally {
      removeAbortListeners();
    }
  }
});
