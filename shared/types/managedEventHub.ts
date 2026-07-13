export const MANAGED_EVENT_HUB_LOOKBACK_MINUTES = [1, 3, 5, 10, 15] as const;

export type ManagedEventHubLookbackMinutes = (typeof MANAGED_EVENT_HUB_LOOKBACK_MINUTES)[number];

export interface ManagedEventHubStreamRequest {
  consumerGroup: string;
  lookbackMinutes: ManagedEventHubLookbackMinutes;
}

export interface ManagedEventHubEventEnvelope {
  type: "events";
  events: Array<{
    body: unknown;
    enqueuedTimeUtc: string;
    partitionId: string;
    sequenceNumber: number;
    offset?: string;
  }>;
}

export interface ManagedEventHubErrorEnvelope {
  type: "error";
  message: "Event Hub receiver error" | "Session expired";
}

export interface ManagedEventHubHeartbeatEnvelope {
  type: "heartbeat";
}

export type ManagedEventHubStreamEnvelope =
  | ManagedEventHubEventEnvelope
  | ManagedEventHubErrorEnvelope
  | ManagedEventHubHeartbeatEnvelope;
