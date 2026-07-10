import type { FirewallLogRecord } from "../../app/types/firewall";
import {
  LOG_HISTORY_INCLUDE_RAW,
  toPersistedFirewallLogRecord,
} from "../../app/utils/logHistoryRecord";

function createLog(overrides: Partial<FirewallLogRecord> = {}): FirewallLogRecord {
  return {
    id: "id",
    timestamp: "2026-07-09T12:00:00.000Z",
    category: "AZFWNetworkRule",
    action: "Allow",
    protocol: "TCP",
    message: "Allow TCP",
    raw: { secret: "raw payload" },
    searchableText: "allow tcp",
    ...overrides,
  };
}

describe("log history record mapping", () => {
  it("maps log records without connection or auth fields", () => {
    const logWithExtraFields: FirewallLogRecord & {
      accessToken: string;
      connectionString: string;
      consumerGroup: string;
      sharedAccessKey: string;
    } = {
      ...createLog(),
      accessToken: "token",
      connectionString: "Endpoint=sb://example/;SharedAccessKey=secret",
      consumerGroup: "$Default",
      sharedAccessKey: "secret",
    };

    const persisted = toPersistedFirewallLogRecord(logWithExtraFields);

    expect(Object.hasOwn(persisted, "accessToken")).toBe(false);
    expect(Object.hasOwn(persisted, "connectionString")).toBe(false);
    expect(Object.hasOwn(persisted, "consumerGroup")).toBe(false);
    expect(Object.hasOwn(persisted, "sharedAccessKey")).toBe(false);
  });

  it("does not persist raw payloads by default", () => {
    const persisted = toPersistedFirewallLogRecord(createLog());

    expect(LOG_HISTORY_INCLUDE_RAW).toBe(false);
    expect(Object.hasOwn(persisted, "raw")).toBe(false);
  });
});
