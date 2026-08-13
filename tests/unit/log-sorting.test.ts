import type { FirewallLogRecord } from "../../shared/types/firewall";
import {
  createDefaultLogSort,
  getNextSortDirection,
  sortFirewallLogs,
} from "../../app/composables/useLogSorting";

function createLog(overrides: Partial<FirewallLogRecord>): FirewallLogRecord {
  return {
    id: "id",
    timestamp: "2026-07-09T12:00:00.000Z",
    category: "AZFWNetworkRule",
    action: "Allow",
    protocol: "TCP",
    message: "Allow TCP",
    raw: {},
    searchableText: "azfwnetworkrule allow tcp",
    ...overrides,
  };
}

describe("log sorting", () => {
  it("sorts out-of-order realtime logs by timestamp", () => {
    const logs = [
      createLog({ id: "middle", timestamp: "2026-08-13T13:05:07.659Z" }),
      createLog({ id: "oldest", timestamp: "2026-08-13T11:55:11.945Z" }),
      createLog({ id: "newest", timestamp: "2026-08-13T13:06:47.932Z" }),
    ];

    expect(sortFirewallLogs(logs, createDefaultLogSort()).map((log) => log.id)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("sorts requested columns without mutating input", () => {
    const logs = [
      createLog({ id: "deny", action: "Deny" }),
      createLog({ id: "allow", action: "Allow" }),
    ];

    const result = sortFirewallLogs(logs, { key: "action", direction: "asc" });

    expect(result.map((log) => log.id)).toEqual(["allow", "deny"]);
    expect(logs.map((log) => log.id)).toEqual(["deny", "allow"]);
  });

  it("sorts Log snapshots by date even when input has another server order", () => {
    const logs = [
      createLog({ id: "oldest", timestamp: "2026-07-09T12:00:00.000Z" }),
      createLog({ id: "newest", timestamp: "2026-07-09T12:00:01.000Z" }),
    ];

    const result = sortFirewallLogs(logs, createDefaultLogSort());

    expect(result.map((log) => log.id)).toEqual(["newest", "oldest"]);
  });

  it("toggles active columns and defaults date to descending", () => {
    expect(getNextSortDirection({ key: "action", direction: "asc" }, "action")).toBe("desc");
    expect(getNextSortDirection({ key: "action", direction: "asc" }, "timestamp")).toBe("desc");
  });
});
