import type { FirewallLogRecord } from "../../app/types/firewall";
import { toPersistedFirewallLogRecord } from "../../app/utils/logHistoryRecord";

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
  it("persists only the log history contract", () => {
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

    expect(persisted).toEqual({
      action: "Allow",
      category: "AZFWNetworkRule",
      id: "id",
      message: "Allow TCP",
      protocol: "TCP",
      searchableText: "allow tcp",
      timestamp: "2026-07-09T12:00:00.000Z",
    });
  });

  it("does not persist raw payloads by default", () => {
    const persisted = toPersistedFirewallLogRecord(createLog());

    expect(Object.hasOwn(persisted, "raw")).toBe(false);
  });
});
