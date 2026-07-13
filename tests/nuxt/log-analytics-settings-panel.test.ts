import { mountSuspended } from "@nuxt/test-utils/runtime";

import LogAnalyticsSettingsPanel from "../../app/components/logs/LogAnalyticsSettingsPanel.vue";
import type { LogAnalysisDateRange } from "../../app/utils/logAnalysis";

function createDraftRange(): LogAnalysisDateRange {
  return {
    from: "2026-07-12T08:00",
    to: "2026-07-12T09:00",
  };
}

function createProps(draftRange = createDraftRange()) {
  return {
    draftRange,
    appliedRangeLabel: "08:00–09:00",
    canRun: true,
    queryStatus: "idle" as const,
    rangeDirty: false,
    rangeError: null,
    resultsTruncated: false,
    temporary: false,
    temporaryAuthError: null,
    temporaryAuthStatus: "idle" as const,
    workspaceId: "",
    "onUpdate:draftRange": (value: LogAnalysisDateRange) => {
      Object.assign(draftRange, value);
    },
    "onUpdate:workspaceId": () => undefined,
  };
}

describe("LogAnalyticsSettingsPanel", () => {
  it("renders date settings, updates the draft range, and emits the run intent", async () => {
    const draftRange = createDraftRange();
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: createProps(draftRange),
    });

    expect(wrapper.get("h2").text()).toBe("Log Analytics settings");
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
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
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

  it("renders temporary Azure authentication controls", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        canRun: false,
        temporary: true,
        temporaryAuthError: "Azure authentication failed.",
      },
    });

    expect(wrapper.text()).toContain("Workspace ID");
    expect(wrapper.text()).toContain("Connect to Azure");
    expect(wrapper.get('[role="alert"]').text()).toBe("Azure authentication failed.");
    const runButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Run query"));
    expect(runButton?.attributes()).toHaveProperty("disabled");
  });

  it("emits temporary connect and disconnect actions for their enabled states", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        canRun: false,
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

    await wrapper.setProps({ temporaryAuthStatus: "connected", canRun: true });
    expect(connect?.attributes()).toHaveProperty("disabled");
    expect(disconnect?.attributes()).not.toHaveProperty("disabled");
    await disconnect!.trigger("click");
    expect(wrapper.emitted("disconnectAzure")).toHaveLength(1);
  });

  it("shows temporary connecting state without rendering controls in managed mode", async () => {
    const wrapper = await mountSuspended(LogAnalyticsSettingsPanel, {
      props: {
        ...createProps(),
        canRun: false,
        temporary: true,
        temporaryAuthStatus: "connecting",
      },
    });
    const connect = wrapper.findAll("button").find((button) => button.text().includes("Connect"));
    expect(connect?.attributes()).toHaveProperty("disabled");

    await wrapper.setProps({ temporary: false, temporaryAuthStatus: "idle" });
    expect(wrapper.text()).not.toContain("Workspace ID");
    expect(wrapper.text()).not.toContain("Connect to Azure");
    expect(wrapper.text()).not.toContain("Disconnect");
  });
});
