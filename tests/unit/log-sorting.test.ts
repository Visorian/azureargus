import type { FirewallLogRecord } from "../../app/types/firewall";
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
  it("keeps default newest-first order without copying", () => {
    const logs = [
      createLog({ id: "newest", timestamp: "2026-07-09T12:00:01.000Z" }),
      createLog({ id: "oldest", timestamp: "2026-07-09T12:00:00.000Z" }),
    ];

    expect(sortFirewallLogs(logs, createDefaultLogSort())).toBe(logs);
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

    const result = sortFirewallLogs(logs, createDefaultLogSort(), false);

    expect(result.map((log) => log.id)).toEqual(["newest", "oldest"]);
  });

  it("toggles active columns and defaults date to descending", () => {
    expect(getNextSortDirection({ key: "action", direction: "asc" }, "action")).toBe("desc");
    expect(getNextSortDirection({ key: "action", direction: "asc" }, "timestamp")).toBe("desc");
  });
});
