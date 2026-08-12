import { mountSuspended } from "@nuxt/test-utils/runtime";

import EventHubSettingsPanel from "../../app/components/logs/EventHubSettingsPanel.vue";
import type { EventHubConnectionForm } from "../../app/composables/useEventHubConnection";

const DEPLOY_EVENT_HUB_URL =
  "https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy-event-hub-only.json";
const DEPLOY_EVENT_HUB_WITH_DIAGNOSTICS_URL =
  "https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy.json";

function createConnectionForm(): EventHubConnectionForm {
  return {
    connectionString: "",
    consumerGroup: "$Default",
    eventHubName: "",
    lookbackMinutes: 15,
    bufferSize: 5_000,
  };
}

function createProps(connectionForm = createConnectionForm()) {
  return {
    connectionForm,
    rememberConnectionString: false,
    clearingLogHistory: false,
    connectionActive: false,
    connecting: false,
    connectionStringPersistenceError: null,
    logHistoryEnabled: true,
    logHistoryError: null,
    managed: false,
    modeTransitioning: false,
    "onUpdate:connectionForm": (value: EventHubConnectionForm) => {
      Object.assign(connectionForm, value);
    },
  };
}

const mountOptions = {
  global: {
    stubs: {
      UTooltip: {
        template: '<div><slot /><slot name="content" /></div>',
      },
    },
  },
};

describe("EventHubSettingsPanel", () => {
  it("offers a safe deployment handoff in anonymous mode", async () => {
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      ...mountOptions,
      props: createProps(),
    });

    const eventHubLink = wrapper.get(`a[href="${DEPLOY_EVENT_HUB_URL}"]`);
    const diagnosticsLink = wrapper.get(`a[href="${DEPLOY_EVENT_HUB_WITH_DIAGNOSTICS_URL}"]`);

    expect(
      wrapper.findAll('a[href^="https://portal.azure.com/#create/Microsoft.Template/uri/"]'),
    ).toHaveLength(2);
    expect(eventHubLink.text()).toContain("Event Hub only");
    expect(eventHubLink.attributes("aria-label")).toBe(
      "Deploy Event Hub only to Azure (opens in new tab)",
    );
    expect(diagnosticsLink.text()).toContain("Event Hub + firewall diagnostics");
    expect(diagnosticsLink.attributes("aria-label")).toBe(
      "Deploy Event Hub and firewall diagnostics to Azure (opens in new tab)",
    );
    for (const deployLink of [eventHubLink, diagnosticsLink]) {
      expect(deployLink.attributes("target")).toBe("_blank");
      expect(deployLink.attributes("rel")).toBe("noopener noreferrer");
    }
    expect(wrapper.text()).toContain("azureargus-listen");
    expect(wrapper.text()).toContain("EntityPath");
  });

  it("renders connection settings, updates form values, and emits connection intents", async () => {
    const connectionForm = createConnectionForm();
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      ...mountOptions,
      props: createProps(connectionForm),
    });

    expect(wrapper.get("h2").text()).toBe("Live Event Hub settings");
    expect(wrapper.text()).toContain("Connection string");
    expect(wrapper.text()).toContain("Consumer group");
    expect(wrapper.text()).toContain("Event Hub name");
    expect(wrapper.text()).toContain("Lookback");
    expect(wrapper.text()).toContain("Visible rows");

    await wrapper.get("textarea").setValue("Endpoint=sb://example/;EntityPath=firewall");
    const inputs = wrapper.findAll("input");
    await inputs[1]!.setValue("firewall-events");
    await inputs[2]!.setValue("1000");

    expect(connectionForm.connectionString).toBe("Endpoint=sb://example/;EntityPath=firewall");
    expect(connectionForm.eventHubName).toBe("firewall-events");
    expect(connectionForm.bufferSize).toBe(1_000);
    expect(wrapper.emitted("update:connectionForm")).toHaveLength(3);

    await wrapper.get('[role="checkbox"]').trigger("click");
    expect(wrapper.emitted("update:rememberConnectionString")).toEqual([[true]]);

    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("connect")).toHaveLength(1);

    const disconnect = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Disconnect"));
    expect(disconnect).toBeDefined();
    await disconnect!.trigger("click");
    expect(wrapper.emitted("disconnect")).toHaveLength(1);
  });

  it("emits retention changes and renders persistence and retention errors", async () => {
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      ...mountOptions,
      props: {
        ...createProps(),
        connectionStringPersistenceError: "Credential could not be saved.",
        logHistoryError: "Saved logs could not be cleared.",
      },
    });

    const alerts = wrapper.findAll('[role="alert"]');
    expect(alerts.map((alert) => alert.text())).toEqual([
      "Credential could not be saved.",
      "Saved logs could not be cleared.",
    ]);

    const retention = wrapper.get('[role="switch"]');
    expect(retention.attributes("aria-checked")).toBe("true");
    await retention.trigger("click");
    expect(wrapper.emitted("updateLogRetention")).toEqual([[false]]);
  });

  it("disables deployment-managed credential settings", async () => {
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      ...mountOptions,
      props: { ...createProps(), managed: true },
    });

    expect(wrapper.text()).toContain("Connection is configured by deployment.");
    expect(wrapper.find(`a[href="${DEPLOY_EVENT_HUB_URL}"]`).exists()).toBe(false);
    expect(wrapper.find(`a[href="${DEPLOY_EVENT_HUB_WITH_DIAGNOSTICS_URL}"]`).exists()).toBe(false);
    expect(wrapper.find("textarea").attributes()).toHaveProperty("disabled");
    expect(wrapper.text()).not.toContain("Remember connection string");
    const eventHubName = wrapper.findAll("input")[1];
    expect(eventHubName?.attributes()).toHaveProperty("disabled");
  });

  it("disables connection fields while the connection is active", async () => {
    const wrapper = await mountSuspended(EventHubSettingsPanel, {
      ...mountOptions,
      props: { ...createProps(), connectionActive: true },
    });

    expect(wrapper.get("textarea").attributes()).toHaveProperty("disabled");
    expect(wrapper.findAll("input").every((input) => "disabled" in input.attributes())).toBe(true);
    expect(wrapper.get('[role="combobox"]').attributes()).toHaveProperty("disabled");
    expect(wrapper.get('[role="checkbox"]').attributes()).not.toHaveProperty("disabled");
    expect(wrapper.get('[role="switch"]').attributes()).not.toHaveProperty("disabled");
  });
});
