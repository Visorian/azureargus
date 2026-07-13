import type { DnsEntry, DnsObservation } from "#shared/types/dns";
import { createDnsEntries } from "#shared/utils/dns";
import type { FirewallLogRecord } from "~/types/firewall";

export interface DnsObservationStoreSnapshot {
  entries: DnsEntry[];
  transports: DnsObservation[];
  evictedEntryIds: string[];
  evictedTransportIds: string[];
}

export function createDnsObservationStore(maxEntries = 10_000, maxTransports = maxEntries) {
  const entries = new Map<string, DnsEntry>();
  const transports = new Map<string, DnsObservation>();

  function newestFirst<T extends { id: string; timestamp: string }>(left: T, right: T) {
    const timestampOrder = right.timestamp.localeCompare(left.timestamp);
    return timestampOrder || right.id.localeCompare(left.id);
  }

  function removeId(id: string) {
    entries.delete(id);
    transports.delete(id);
  }

  function snapshot(
    evictedEntryIds: string[] = [],
    evictedTransportIds: string[] = [],
  ): DnsObservationStoreSnapshot {
    return {
      entries: [...entries.values()].toSorted(newestFirst),
      transports: [...transports.values()].toSorted(newestFirst),
      evictedEntryIds,
      evictedTransportIds,
    };
  }

  function pushRecords(records: readonly FirewallLogRecord[]) {
    for (const record of records) {
      if (!record.dns) continue;
      removeId(record.dns.id);
      if (record.dns.source === "network-rule") {
        transports.set(record.dns.id, record.dns);
      } else {
        const entry = createDnsEntries([record.dns])[0];
        if (entry) {
          entries.set(record.dns.id, entry);
        }
      }
    }

    const evictedEntryIds: string[] = [];
    const evictedTransportIds: string[] = [];
    while (entries.size > maxEntries) {
      const evicted = entries.keys().next().value;
      if (typeof evicted !== "string") break;
      entries.delete(evicted);
      evictedEntryIds.push(evicted);
    }
    while (transports.size > maxTransports) {
      const evicted = transports.keys().next().value;
      if (typeof evicted !== "string") break;
      transports.delete(evicted);
      evictedTransportIds.push(evicted);
    }
    return { evictedEntryIds, evictedTransportIds };
  }

  function clear() {
    entries.clear();
    transports.clear();
    return snapshot();
  }

  return {
    clear,
    pushRecords,
    snapshot,
  };
}
