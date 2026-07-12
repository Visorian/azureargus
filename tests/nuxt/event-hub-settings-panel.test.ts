import { mountSuspended } from "@nuxt/test-utils/runtime";

import EventHubSettingsPanel from "../../app/components/logs/EventHubSettingsPanel.vue";
import type { EventHubConnectionForm } from "../../app/composables/useEventHubConnection";

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
    connecting: false,
    connectionStringPersistenceError: null,
    logHistoryEnabled: true,
    logHistoryError: null,
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
});
