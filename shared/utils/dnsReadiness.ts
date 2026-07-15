import type { DnsReadinessSourceKind, DnsSourceReadiness } from "../types/dns";
import type { LogAnalyticsStorageKind } from "../types/logAnalytics";

export type DnsReadinessSourceGroup = "dns" | "general";

export interface DnsReadinessSourceDefinition {
  source: DnsReadinessSourceKind;
  friendlyLabel: string;
  resourceSpecificTable: string;
  azureDiagnosticsCategory: string;
  group: DnsReadinessSourceGroup;
  queryScope?: string;
}

export const DNS_READINESS_SOURCE_DEFINITIONS = [
  {
    source: "proxy-structured",
    friendlyLabel: "Structured DNS proxy logs",
    resourceSpecificTable: "AZFWDnsQuery",
    azureDiagnosticsCategory: "AZFWDnsQuery",
    group: "dns",
  },
  {
    source: "dns-flow-trace",
    friendlyLabel: "DNS flow trace logs",
    resourceSpecificTable: "AZFWDnsFlowTrace",
    azureDiagnosticsCategory: "AZFWDnsAdditional",
    group: "dns",
  },
  {
    source: "internal-fqdn-failure",
    friendlyLabel: "Internal FQDN resolution failures",
    resourceSpecificTable: "AZFWInternalFqdnResolutionFailure",
    azureDiagnosticsCategory: "AZFWFqdnResolveFailure",
    group: "dns",
  },
  {
    source: "network-rule",
    friendlyLabel: "Network rule logs",
    resourceSpecificTable: "AZFWNetworkRule",
    azureDiagnosticsCategory: "AZFWNetworkRule",
    group: "general",
    queryScope: "TCP/UDP port 53",
  },
  {
    source: "application-rule",
    friendlyLabel: "Application rule logs",
    resourceSpecificTable: "AZFWApplicationRule",
    azureDiagnosticsCategory: "AZFWApplicationRule",
    group: "general",
    queryScope: "FQDN-bearing records",
  },
  {
    source: "flow-trace",
    friendlyLabel: "TCP flow trace logs",
    resourceSpecificTable: "AZFWFlowTrace",
    azureDiagnosticsCategory: "AZFWFlowTrace",
    group: "general",
    queryScope: "TCP port 53",
  },
  {
    source: "nat-rule",
    friendlyLabel: "NAT rule logs",
    resourceSpecificTable: "AZFWNatRule",
    azureDiagnosticsCategory: "AZFWNatRule",
    group: "general",
    queryScope: "port 53",
  },
] as const satisfies readonly DnsReadinessSourceDefinition[];

export function hasDnsReadinessData(
  readiness: readonly DnsSourceReadiness[],
  storage: LogAnalyticsStorageKind,
) {
  return readiness.some(
    (item) =>
      item.storage === storage &&
      item.status === "success" &&
      item.sampleCount > 0 &&
      (storage === "resource-specific" || item.source === "network-rule"),
  );
}
