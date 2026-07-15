import type { DnsSourceReadiness } from "../../shared/types/dns";
import { hasDnsReadinessData } from "../../shared/utils/dnsReadiness";

describe("DNS source readiness", () => {
  it("requires supported network-rule data before selecting AzureDiagnostics", () => {
    const readiness: DnsSourceReadiness[] = [
      {
        source: "application-rule",
        storage: "azure-diagnostics",
        status: "success",
        sampleCount: 2,
      },
      {
        source: "network-rule",
        storage: "azure-diagnostics",
        status: "success",
        sampleCount: 0,
      },
    ];

    expect(hasDnsReadinessData(readiness, "azure-diagnostics")).toBe(false);

    readiness[1] = {
      source: "network-rule",
      storage: "azure-diagnostics",
      status: "success",
      sampleCount: 1,
    };
    expect(hasDnsReadinessData(readiness, "azure-diagnostics")).toBe(true);
  });

  it("accepts data from every supported resource-specific source", () => {
    const readiness: DnsSourceReadiness[] = [
      {
        source: "application-rule",
        storage: "resource-specific",
        status: "success",
        sampleCount: 1,
      },
    ];

    expect(hasDnsReadinessData(readiness, "resource-specific")).toBe(true);
  });
});
