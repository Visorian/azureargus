import { mountSuspended } from "@nuxt/test-utils/runtime";

import LogAnalyticsQueryControls from "../../app/components/logs/LogAnalyticsQueryControls.vue";
import LogAnalyticsSettingsPanel from "../../app/components/logs/LogAnalyticsSettingsPanel.vue";
import type { LogAnalysisDateRange } from "../../app/utils/logAnalysis";

function createDraftRange(): LogAnalysisDateRange {
  return {
    from: "2026-07-12T08:00",
    to: "2026-07-12T09:00",
  };
}

function createQueryProps(draftRange = createDraftRange()) {
  return {
    draftRange,
    appliedRangeLabel: "08:00–09:00",
    canRun: true,
    queryStatus: "idle" as const,
    rangeDirty: false,
    rangeError: null,
    resultsTruncated: false,
    "onUpdate:draftRange": (value: LogAnalysisDateRange) => {
      Object.assign(draftRange, value);
    },
  };
}

function createProps() {
  return {
    adminConsentUrl: null,
    dnsReadiness: [],
    dnsReadinessStatus: "idle" as const,
    lens: "all-logs" as const,
    queryLimit: 1_000,
    queryStorage: "resource-specific" as const,
    temporary: false,
    temporaryAccessError: null,
    temporaryAccessStatus: "idle" as const,
    temporaryLogAnalyticsAuthorized: false,
    temporaryLogAnalyticsAuthorizing: false,
    temporaryAuthError: null,
    temporaryAuthStatus: "idle" as const,
    temporaryAzureUsername: "",
    tenantId: "",
    tenantOptions: [],
    workspaceId: "",
    workspaceOptions: [],
    "onUpdate:tenantId": () => undefined,
    "onUpdate:queryLimit": () => undefined,
    "onUpdate:queryStorage": () => undefined,
    "onUpdate:workspaceId": () => undefined,
  };
}

describe("LogAnalyticsQueryControls", () => {
  it("updates the draft range and emits the run intent", async () => {
    const draftRange = createDraftRange();
    const wrapper = await mountSuspended(LogAnalyticsQueryControls, {
      props: createQueryProps(draftRange),
    });

    expect(wrapper.text()).toContain("Start");
    expect(wrapper.text()).toContain("End");

    const inputs = wrapper.findAll('input[type="datetime-local"]');
    await inputs[0]!.setValue("2026-07-12T07:30");
    await inputs[1]!.setValue("2026-07-12T09:30");
    expect(draftRange).toEqual({
      from: "2026-07-12T07:30",
      to: "2026-07-12T09:30",
    });
    expect(wrapper.emitted("update:draftRange")).toHaveLength(2);

    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it("renders loading, dirty-range, error, and truncation states", async () => {
    const wrapper = await mountSuspended(LogAnalyticsQueryControls, {
      props: {
        ...createQueryProps(),
        queryStatus: "loading",
        rangeDirty: true,
        resultsTruncated: true,
      },
    });

    const runButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Run query"));
    expect(runButton).toBeDefined();
    expect(runButton!.attributes()).toHaveProperty("disabled");
    expect(wrapper.text()).toContain(
      "Run query to apply date range. Results still show 08:00–09:00.",
    );
    expect(wrapper.text()).toContain(
      "Result limit reached. Narrow filters or time range for complete results.",
    );

    await wrapper.setProps({ rangeError: "Start date must be before end date." });
    expect(wrapper.get('[role="alert"]').text()).toBe("Start date must be before end date.");
    expect(wrapper.text()).not.toContain("Run query to apply date range.");
  });
});

describe("LogAnalyticsSettingsPanel", () => {
  it("renders temporary Azure authentication controls", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        temporary: true,
        temporaryAuthError: "Azure authentication failed.",
      },
    });

    expect(wrapper.text()).not.toContain("Tenant ID");
    expect(wrapper.text()).not.toContain("Workspace ID");
    expect(wrapper.text()).not.toContain("Grant tenant consent");
    expect(wrapper.text()).not.toContain("Permissions");
    expect(wrapper.text()).toContain("Connect to Azure");
    expect(wrapper.get('[role="alert"]').text()).toBe("Azure authentication failed.");
    expect(wrapper.text()).not.toContain("Run query");
  });

  it("emits temporary connect and disconnect actions for their enabled states", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        temporary: true,
      },
    });
    const buttons = wrapper.findAll("button");
    const connect = buttons.find((button) => button.text().includes("Connect to Azure"));
    const disconnect = buttons.find((button) => button.text().includes("Disconnect"));

    expect(connect?.attributes()).not.toHaveProperty("disabled");
    expect(disconnect?.attributes()).toHaveProperty("disabled");
    await connect!.trigger("click");
    expect(wrapper.emitted("connectAzure")).toHaveLength(1);

    await wrapper.setProps({
      adminConsentUrl: "https://login.microsoftonline.com/consent",
      temporaryAccessStatus: "success",
      temporaryAuthStatus: "connected",
      temporaryAzureUsername: "user@example.com",
      temporaryLogAnalyticsAuthorized: true,
      tenantId: "22222222-2222-4222-8222-222222222222",
      tenantOptions: [
        {
          defaultDomain: "target.example",
          displayName: "Target tenant",
          tenantId: "22222222-2222-4222-8222-222222222222",
        },
      ],
      workspaceId: "33333333-3333-4333-8333-333333333333",
      workspaceOptions: [
        {
          location: "westeurope",
          name: "firewall-logs",
          resourceGroup: "firewall",
          subscriptionId: "44444444-4444-4444-8444-444444444444",
          subscriptionName: "Production",
          workspaceId: "33333333-3333-4333-8333-333333333333",
        },
      ],
    });
    expect(connect?.attributes()).toHaveProperty("disabled");
    expect(disconnect?.attributes()).not.toHaveProperty("disabled");
    expect(wrapper.text()).toContain("Connected as user@example.com.");
    expect(wrapper.text()).toContain("Directory");
    expect(wrapper.text()).toContain("Workspace");
    const selectors = wrapper.findAllComponents({ name: "USelectMenu" });
    expect(selectors).toHaveLength(2);
    expect(selectors[1]?.props("placeholder")).toBe("Select a workspace");
    expect(wrapper.get('a[href="https://login.microsoftonline.com/consent"]').text()).toContain(
      "Grant tenant consent",
    );
    expect(wrapper.get('a[href*="Microsoft.OperationalInsights%2Fworkspaces"]').text()).toContain(
      "Permissions",
    );
    const refresh = wrapper.findAll("button").find((button) => button.text() === "Refresh");
    selectors[0]?.vm.$emit("update:modelValue", "55555555-5555-4555-8555-555555555555");
    expect(wrapper.emitted("changeTenant")?.[0]).toEqual(["55555555-5555-4555-8555-555555555555"]);
    selectors[1]?.vm.$emit("update:modelValue", "66666666-6666-4666-8666-666666666666");
    expect(wrapper.emitted("changeWorkspace")?.[0]).toEqual([
      "66666666-6666-4666-8666-666666666666",
    ]);
    await refresh!.trigger("click");
    expect(wrapper.emitted("refreshAzureAccess")).toHaveLength(1);
    await disconnect!.trigger("click");
    expect(wrapper.emitted("disconnectAzure")).toHaveLength(1);
  });

  it("requires tenant consent before enabling workspace controls", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        adminConsentUrl: "https://login.microsoftonline.com/consent",
        temporary: true,
        temporaryAccessStatus: "success",
        temporaryAuthStatus: "connected",
        tenantId: "22222222-2222-4222-8222-222222222222",
        tenantOptions: [
          {
            defaultDomain: "target.example",
            displayName: "Target tenant",
            tenantId: "22222222-2222-4222-8222-222222222222",
          },
        ],
        workspaceOptions: [
          {
            location: "westeurope",
            name: "firewall-logs",
            resourceGroup: "firewall",
            subscriptionId: "44444444-4444-4444-8444-444444444444",
            subscriptionName: "Production",
            workspaceId: "33333333-3333-4333-8333-333333333333",
          },
        ],
      },
    });

    const workspaceSelector = wrapper.findAllComponents({ name: "USelectMenu" })[1]!;
    const buttons = wrapper.findAllComponents({ name: "UButton" });
    const checkConsent = buttons.find((button) => button.props("label") === "Refresh consent")!;
    const refresh = buttons.find((button) => button.props("label") === "Refresh")!;
    const permissions = buttons.find((button) => button.props("label") === "Permissions")!;

    expect(workspaceSelector.props("placeholder")).toBe("Grant tenant consent first");
    expect(workspaceSelector.props("disabled")).toBe(true);
    expect(refresh.props("disabled")).toBe(true);
    expect(permissions.props("disabled")).toBe(true);
    expect(wrapper.text()).toContain("Grant tenant consent before selecting a workspace.");
    await checkConsent.trigger("click");
    expect(wrapper.emitted("authorizeLogAnalytics")).toHaveLength(1);

    await wrapper.setProps({ temporaryLogAnalyticsAuthorized: true });
    expect(workspaceSelector.props("placeholder")).toBe("Select a workspace");
    expect(workspaceSelector.props("disabled")).toBe(false);
    expect(refresh.props("disabled")).toBe(false);
    expect(permissions.props("disabled")).toBe(false);
    expect(wrapper.text()).toContain("Log Analytics access available for selected directory.");
  });

  it("distinguishes discovered workspace selection and completed setup steps", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        temporary: true,
        temporaryAccessStatus: "success",
        temporaryAuthStatus: "connected",
        tenantId: "22222222-2222-4222-8222-222222222222",
        tenantOptions: [
          {
            defaultDomain: "target.example",
            displayName: "Target tenant",
            tenantId: "22222222-2222-4222-8222-222222222222",
          },
        ],
        workspaceOptions: [
          {
            location: "westeurope",
            name: "firewall-logs",
            resourceGroup: "firewall",
            subscriptionId: "44444444-4444-4444-8444-444444444444",
            subscriptionName: "Production",
            workspaceId: "33333333-3333-4333-8333-333333333333",
          },
        ],
      },
    });

    const selectors = wrapper.findAllComponents({ name: "USelectMenu" });
    const indicators = wrapper.findAll(
      'ol[aria-label="Temporary Log Analytics setup"] > li > span',
    );
    expect(selectors[1]?.props("placeholder")).toBe("Grant tenant consent first");
    expect(indicators[1]?.classes()).toContain("bg-brand-gray-100");
    expect(indicators[2]?.classes()).toContain("bg-brand-gray-100");

    await wrapper.setProps({
      workspaceId: "33333333-3333-4333-8333-333333333333",
      temporaryLogAnalyticsAuthorized: true,
    });
    expect(indicators[1]?.classes()).toContain("bg-brand-blue-50");
    expect(indicators[2]?.classes()).toContain("bg-brand-blue-50");
    expect(wrapper.text()).toContain("Log Analytics access available for selected directory.");
    const authorize = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Refresh consent"));
    expect(authorize?.attributes()).not.toHaveProperty("disabled");
  });

  it("shows temporary connecting state without rendering controls in managed mode", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        temporary: true,
        temporaryAuthStatus: "connecting",
      },
    });
    const connect = wrapper.findAll("button").find((button) => button.text().includes("Connect"));
    expect(connect?.attributes()).toHaveProperty("disabled");

    await wrapper.setProps({ temporary: false, temporaryAuthStatus: "idle" });
    expect(wrapper.findAllComponents({ name: "USelectMenu" })).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Directory");
    expect(wrapper.text()).not.toContain("Connect to Azure");
    expect(wrapper.text()).not.toContain("Disconnect");
  });

  it("shows DNS readiness requirements in every Log Analytics view", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: createProps(),
    });

    expect(wrapper.text()).toContain("Query configured Azure Firewall workspace");
    expect(wrapper.text()).toContain("Source readiness");
    const readinessRows: Array<[string, string]> = [
      ["Structured DNS proxy logs", "AZFWDnsQuery"],
      ["DNS flow trace logs", "AZFWDnsFlowTrace / AZFWDnsAdditional"],
      [
        "Internal FQDN resolution failures",
        "AZFWInternalFqdnResolutionFailure / AZFWFqdnResolveFailure",
      ],
      ["Network rule logs", "AZFWNetworkRule · TCP/UDP port 53"],
      ["Application rule logs", "AZFWApplicationRule · FQDN-bearing records"],
      ["TCP flow trace logs", "AZFWFlowTrace · TCP port 53"],
      ["NAT rule logs", "AZFWNatRule · port 53"],
    ];
    for (const [label, mapping] of readinessRows) {
      const row = wrapper.findAll("tr").find((candidate) => candidate.text().includes(label));
      expect(row?.text()).toContain(mapping);
    }
    const readinessGroups = wrapper.findAll("tbody");
    expect(readinessGroups[0]?.text()).toContain("DNS sources");
    expect(readinessGroups[0]?.text()).not.toContain("Network rule logs");
    expect(readinessGroups[1]?.text()).toContain("General firewall logs");
    expect(readinessGroups[1]?.text()).toContain("Network rule logs");
    expect(wrapper.text()).toContain("General firewall logs");
    expect(wrapper.text()).not.toContain("Legacy DNS proxy logs");
    expect(wrapper.findAll('th[scope="col"]').map((header) => header.text())).toEqual([
      "Source",
      "Table",
      "AzureDiagnostics",
    ]);
    const initialIndicators = wrapper.findAll("td [aria-label]");
    expect(initialIndicators).toHaveLength(14);
    expect(initialIndicators.every((indicator) => indicator.attributes("role") === "img")).toBe(
      true,
    );
    expect(
      initialIndicators.every((indicator) =>
        indicator.attributes("aria-label")?.endsWith(": not checked"),
      ),
    ).toBe(true);
    expect(wrapper.text()).toContain("Waiting for workspace check.");
    const queryStorageSelect = wrapper.getComponent({ name: "USelect" });
    expect(queryStorageSelect.props("modelValue")).toBe("resource-specific");
    expect(queryStorageSelect.props("disabled")).toBe(true);

    await wrapper.setProps({ dnsReadinessStatus: "loading" });
    expect(wrapper.get('[role="status"]').text()).toContain("Checking selected workspace");
    expect(
      wrapper
        .findAll("td [aria-label]")
        .every((indicator) => indicator.attributes("aria-label")?.endsWith(": checking")),
    ).toBe(true);

    await wrapper.setProps({ dnsReadinessStatus: "error" });
    expect(wrapper.get('[role="alert"]').text()).toContain("Source readiness check failed");

    await wrapper.setProps({
      dnsReadinessStatus: "success",
      dnsReadiness: [
        {
          source: "proxy-structured",
          storage: "resource-specific",
          status: "success",
          sampleCount: 2,
        },
        {
          source: "proxy-structured",
          storage: "azure-diagnostics",
          status: "missing",
          sampleCount: null,
        },
        {
          source: "dns-flow-trace",
          storage: "resource-specific",
          status: "missing",
          sampleCount: null,
        },
        {
          source: "dns-flow-trace",
          storage: "azure-diagnostics",
          status: "success",
          sampleCount: 2,
        },
        {
          source: "internal-fqdn-failure",
          storage: "resource-specific",
          status: "success",
          sampleCount: 2,
        },
        {
          source: "internal-fqdn-failure",
          storage: "azure-diagnostics",
          status: "success",
          sampleCount: 2,
        },
        {
          source: "network-rule",
          storage: "resource-specific",
          status: "missing",
          sampleCount: null,
        },
        {
          source: "network-rule",
          storage: "azure-diagnostics",
          status: "missing",
          sampleCount: null,
        },
        {
          source: "application-rule",
          storage: "resource-specific",
          status: "forbidden",
          sampleCount: null,
        },
        {
          source: "application-rule",
          storage: "azure-diagnostics",
          status: "missing",
          sampleCount: null,
        },
        {
          source: "flow-trace",
          storage: "resource-specific",
          status: "failed",
          sampleCount: null,
        },
        {
          source: "flow-trace",
          storage: "azure-diagnostics",
          status: "missing",
          sampleCount: null,
        },
        {
          source: "nat-rule",
          storage: "resource-specific",
          status: "missing",
          sampleCount: null,
        },
        {
          source: "nat-rule",
          storage: "azure-diagnostics",
          status: "missing",
          sampleCount: null,
        },
      ],
    });
    function readinessIndicators(label: string) {
      const row = wrapper.findAll("tr").find((item) => item.text().includes(label));
      if (!row) throw new Error(`Readiness row not found: ${label}`);
      return row.findAll("[aria-label]").map((indicator) => indicator.attributes("aria-label"));
    }

    expect(wrapper.text()).toContain("Dedicated tables 2/7 available");
    expect(wrapper.text()).toContain("AzureDiagnostics 2/7 with data");
    expect(readinessIndicators("Structured DNS proxy logs")).toEqual([
      "Dedicated table: available",
      "AzureDiagnostics: not found",
    ]);
    expect(readinessIndicators("DNS flow trace logs")).toEqual([
      "Dedicated table: not found",
      "AzureDiagnostics: available",
    ]);
    expect(readinessIndicators("Internal FQDN resolution failures")).toEqual([
      "Dedicated table: available",
      "AzureDiagnostics: available",
    ]);
    expect(readinessIndicators("Network rule logs")).toEqual([
      "Dedicated table: not found",
      "AzureDiagnostics: not found",
    ]);
    expect(readinessIndicators("Application rule logs")).toEqual([
      "Dedicated table: access denied",
      "AzureDiagnostics: not found",
    ]);
    expect(readinessIndicators("TCP flow trace logs")).toEqual([
      "Dedicated table: check failed",
      "AzureDiagnostics: not found",
    ]);
    expect(readinessIndicators("NAT rule logs")).toEqual([
      "Dedicated table: not found",
      "AzureDiagnostics: not found",
    ]);
    expect(queryStorageSelect.props("disabled")).toBe(true);

    await wrapper.setProps({ lens: "dns-troubleshooting" });
    expect(wrapper.text()).toContain("Query DNS diagnostics");
    expect(wrapper.text()).toContain("Source readiness");
    expect(wrapper.text()).toContain("Table");
  });

  it("enables query storage selection only when both stores contain records", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        dnsReadinessStatus: "success",
        dnsReadiness: [
          {
            source: "network-rule",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "network-rule",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 0,
          },
        ],
      },
    });
    const queryStorageSelect = wrapper.getComponent({ name: "USelect" });

    expect(queryStorageSelect.props("disabled")).toBe(true);
    const networkRuleRow = wrapper
      .findAll("tr")
      .find((item) => item.text().includes("Network rule logs"));
    expect(
      networkRuleRow
        ?.findAll("[aria-label]")
        .map((indicator) => indicator.attributes("aria-label")),
    ).toEqual(["Dedicated table: available", "AzureDiagnostics: no matching records"]);
    await wrapper.setProps({
      dnsReadiness: [
        {
          source: "network-rule",
          storage: "resource-specific",
          status: "success",
          sampleCount: 2,
        },
        {
          source: "network-rule",
          storage: "azure-diagnostics",
          status: "success",
          sampleCount: 1,
        },
      ],
    });
    expect(queryStorageSelect.props("disabled")).toBe(false);

    queryStorageSelect.vm.$emit("update:modelValue", "azure-diagnostics");
    expect(wrapper.emitted("update:queryStorage")?.[0]).toEqual(["azure-diagnostics"]);
    await wrapper.setProps({ queryStorage: "azure-diagnostics" });
    expect(queryStorageSelect.props("modelValue")).toBe("azure-diagnostics");
  });

  it("shows DNS readiness after a temporary workspace is selected", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        temporary: true,
      },
    });

    expect(wrapper.text()).not.toContain("Source readiness");

    await wrapper.setProps({
      workspaceId: "33333333-3333-4333-8333-333333333333",
    });
    expect(wrapper.text()).toContain("Source readiness");
    expect(wrapper.text()).toContain("Waiting for workspace check.");
  });

  it("exposes bounded query result limit in managed and temporary modes", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: createProps(),
    });
    const input = wrapper.getComponent({ name: "UInputNumber" });

    expect(input.props()).toMatchObject({ min: 100, max: 5_000, step: 100, modelValue: 1_000 });
    input.vm.$emit("update:modelValue", 2_000);
    expect(wrapper.emitted("update:queryLimit")?.[0]).toEqual([2_000]);
    expect(wrapper.text()).toContain("Applies to next query.");

    await wrapper.setProps({ temporary: true });
    expect(wrapper.findComponent({ name: "UInputNumber" }).exists()).toBe(true);
  });
});
