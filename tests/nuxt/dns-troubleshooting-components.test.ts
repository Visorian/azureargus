import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent } from "vue";

import DnsDetailModal from "../../app/components/logs/DnsDetailModal.vue";
import DnsTroubleshootingView from "../../app/components/logs/DnsTroubleshootingView.vue";
import type {
  DnsEntry,
  DnsFilterOptions,
  DnsFilters,
  DnsObservation,
  DnsSort,
} from "../../shared/types/dns";

const filterOptions = {
  outcomes: ["response-unknown", "transport-observed"],
  protocols: ["TCP", "UDP"],
  queryTypes: ["A", "AAAA"],
  sources: ["network-rule", "proxy-structured"],
} satisfies DnsFilterOptions;

const observation: DnsObservation = {
  id: "observation-1",
  timestamp: "2026-07-12T08:30:00.000Z",
  source: "proxy-structured",
  stage: "proxy-exchange",
  path: "proxy",
  outcome: "response-unknown",
  queryName: "api.example.",
  queryType: "A",
  clientIp: "10.0.0.4",
  clientPort: "53000",
  protocol: "UDP",
  responseCode: "NOERROR",
  responseFlags: ["qr", "rd", "ra"],
  responseSizeBytes: 300,
  parseState: "parsed",
  warnings: [],
  raw: { ResponseSize: 300 },
};

const entry: DnsEntry = {
  id: "entry-1",
  timestamp: observation.timestamp,
  queryName: observation.queryName,
  queryType: observation.queryType,
  client: "10.0.0.4:53000",
  protocol: "UDP",
  path: "proxy",
  outcome: "response-unknown",
  observationCount: 1,
  completeness: "complete",
  confidence: "explicit",
  source: "proxy-structured",
  warnings: [],
  observations: [observation],
};

function createFilters(): DnsFilters {
  return { search: "", queryType: "", client: "", protocol: "", outcome: "", source: "" };
}

const RecycleScrollerStub = defineComponent({
  props: { items: { type: Array, required: true } },
  template: '<div><slot v-for="item in items" :item="item" /></div>',
});
const SelectStub = defineComponent({
  inheritAttrs: false,
  props: {
    items: { type: Array, required: true },
    modelValue: { type: String, required: true },
  },
  emits: ["update:modelValue"],
  template: `
    <select
      v-bind="$attrs"
      :value="modelValue"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option v-for="item in items" :key="item.value" :value="item.value">
        {{ item.label }}
      </option>
    </select>
  `,
});

describe("DNS troubleshooting components", () => {
  it("renders enabled unidentified transport as partial DNS activity and emits selection", async () => {
    const filters = createFilters();
    const transport = {
      ...observation,
      id: "transport-1",
      source: "network-rule" as const,
      outcome: "transport-observed" as const,
      queryName: undefined,
      queryType: undefined,
      serverIp: "168.63.129.16",
      serverPort: "53",
    };
    const transportEntry: DnsEntry = {
      id: transport.id,
      timestamp: transport.timestamp,
      client: "10.0.0.4:53000",
      protocol: transport.protocol,
      path: transport.path,
      outcome: transport.outcome,
      observationCount: 1,
      completeness: "partial",
      confidence: "uncorrelated",
      source: transport.source,
      warnings: [],
      observations: [transport],
    };
    const wrapper = await mountSuspended(DnsTroubleshootingView, {
      props: {
        entries: [entry, transportEntry],
        filters,
        showUnidentifiedTransports: true,
        sources: [],
        status: "success",
        error: null,
        entriesTruncated: false,
        transportsTruncated: true,
        logAnalysis: false,
        canApplyFilters: false,
        filterOptions,
        selectedEntryId: null,
        sort: { key: "timestamp", direction: "desc" },
        "onUpdate:filters": (value: DnsFilters) => Object.assign(filters, value),
      },
      global: { stubs: { RecycleScroller: RecycleScrollerStub } },
    });

    expect(wrapper.text()).toContain("DNS activity");
    expect(wrapper.text()).toContain("api.example.");
    expect(wrapper.text()).toContain("Not observed");
    expect(wrapper.text()).toContain("10.0.0.4:53000");
    expect(wrapper.text()).toContain("168.63.129.16:53");
    expect(wrapper.text()).toContain("Observations");
    expect(wrapper.text()).toContain("Destination");
    expect(wrapper.text()).toContain("Unidentified transport truncated");
    expect(wrapper.text()).toContain("Partial");
    expect(wrapper.text()).toContain("Response received");
    expect(wrapper.text()).toContain("Transport observed");
    expect(wrapper.text()).not.toContain("response-unknown");
    expect(wrapper.text()).not.toContain("Entries truncated");
    expect(wrapper.text()).not.toContain("Source query failed");

    await wrapper.get('button[aria-label="Open DNS details for api.example."]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([entry]);
    await wrapper
      .get('button[aria-label="Open DNS transport details for 10.0.0.4:53000"]')
      .trigger("click");
    expect(wrapper.emitted("select")?.[1]).toEqual([transportEntry]);
  });

  it("keeps retained DNS results visible and reports partial source failures", async () => {
    const wrapper = await mountSuspended(DnsTroubleshootingView, {
      props: {
        entries: [entry],
        filters: createFilters(),
        showUnidentifiedTransports: false,
        sources: [
          {
            source: "proxy-structured",
            availability: "available",
            truncated: false,
          },
          {
            source: "network-rule",
            availability: "failed",
            truncated: false,
            warning: "DNS transport query failed",
          },
        ],
        status: "success",
        error: null,
        entriesTruncated: false,
        transportsTruncated: false,
        logAnalysis: true,
        canApplyFilters: false,
        filterOptions,
        selectedEntryId: null,
        sort: { key: "timestamp", direction: "desc" },
        "onUpdate:filters": () => undefined,
      },
      global: { stubs: { RecycleScroller: RecycleScrollerStub } },
    });

    expect(wrapper.get('[role="status"]').text()).toContain(
      "Some DNS sources could not be queried.",
    );
    expect(wrapper.get('[role="status"]').text()).toContain("DNS transport query failed");
    expect(wrapper.text()).toContain("api.example.");
    expect(wrapper.text()).not.toContain("No entries returned by available DNS sources.");
  });

  it("shows DNS list request errors", async () => {
    const wrapper = await mountSuspended(DnsTroubleshootingView, {
      props: {
        entries: [],
        filters: createFilters(),
        showUnidentifiedTransports: false,
        sources: [],
        status: "error",
        error: "DNS query failed.",
        entriesTruncated: false,
        transportsTruncated: false,
        logAnalysis: true,
        canApplyFilters: false,
        filterOptions,
        selectedEntryId: null,
        sort: { key: "timestamp", direction: "desc" },
        "onUpdate:filters": () => undefined,
      },
      global: { stubs: { RecycleScroller: RecycleScrollerStub } },
    });

    expect(wrapper.get('[role="alert"]').text()).toBe("DNS query failed.");
    expect(wrapper.text()).not.toContain("No matching DNS entries.");
    expect(wrapper.text()).not.toContain("Source query failed");
  });

  it("keeps matching filter actions in the filter row and query controls in the next row", async () => {
    const wrapper = await mountSuspended(DnsTroubleshootingView, {
      props: {
        entries: [],
        filters: createFilters(),
        showUnidentifiedTransports: false,
        sources: [],
        status: "success",
        error: null,
        entriesTruncated: false,
        transportsTruncated: false,
        logAnalysis: true,
        canApplyFilters: true,
        filterOptions,
        selectedEntryId: null,
        sort: { key: "timestamp", direction: "desc" },
        "onUpdate:filters": () => undefined,
      },
      slots: { "query-controls": "<div>Query controls</div>" },
      global: { stubs: { RecycleScroller: RecycleScrollerStub } },
    });

    const filterRow = wrapper.get('[data-testid="log-filter-row"]');
    const filterGrid = filterRow.get('[data-testid="dns-filter-grid"]');
    const filterActions = wrapper.get('[data-testid="log-filter-actions"]');
    const buttons = filterActions.findAllComponents({ name: "UButton" });
    expect(buttons[0]?.props("label")).toBe("Apply filters");
    expect(buttons[1]?.props("label")).toBe("Reset");
    expect(buttons[1]?.props()).toMatchObject({ color: "neutral", variant: "ghost" });

    await buttons[0]!.trigger("click");
    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("apply")).toHaveLength(1);
    expect(wrapper.emitted("reset")).toHaveLength(1);
    expect(wrapper.get('[data-testid="log-query-row"]').text()).toContain("Query controls");
    expect(filterRow.element.contains(filterGrid.element)).toBe(true);
    expect(filterRow.element.contains(filterActions.element)).toBe(true);
    expect(filterRow.getComponent({ name: "UCheckbox" }).props("label")).toBe(
      "Show unidentified DNS transport",
    );
  });

  it("maps explicit sort-order choices without a separate direction control", async () => {
    const sort: DnsSort = { key: "timestamp", direction: "desc" };
    const wrapper = await mountSuspended(DnsTroubleshootingView, {
      props: {
        entries: [],
        filters: createFilters(),
        showUnidentifiedTransports: false,
        sources: [],
        status: "success",
        error: null,
        entriesTruncated: false,
        transportsTruncated: false,
        logAnalysis: false,
        canApplyFilters: false,
        filterOptions,
        selectedEntryId: null,
        sort,
        "onUpdate:filters": () => undefined,
        "onUpdate:sort": (value: DnsSort) => Object.assign(sort, value),
      },
      global: {
        stubs: {
          RecycleScroller: RecycleScrollerStub,
          USelect: SelectStub,
        },
      },
    });
    const select = wrapper.get<HTMLSelectElement>('select[aria-label="DNS sort order"]');
    const choices: Array<[string, DnsSort]> = [
      ["timestamp-desc", { key: "timestamp", direction: "desc" }],
      ["timestamp-asc", { key: "timestamp", direction: "asc" }],
      ["queryName-asc", { key: "queryName", direction: "asc" }],
      ["queryName-desc", { key: "queryName", direction: "desc" }],
      ["duration-asc", { key: "duration", direction: "asc" }],
      ["duration-desc", { key: "duration", direction: "desc" }],
      ["observations-asc", { key: "observations", direction: "asc" }],
      ["observations-desc", { key: "observations", direction: "desc" }],
    ];

    expect(select.element.value).toBe("timestamp-desc");
    expect(wrapper.text()).not.toContain("Ascending");
    expect(wrapper.text()).not.toContain("Descending");
    for (const [choice, expected] of choices) {
      await select.setValue(choice);
      expect(sort).toEqual(expected);
    }
  });

  it("shows observed proxy flow and decoded response bytes in detail", async () => {
    const wrapper = await mountSuspended(DnsDetailModal, {
      props: {
        open: true,
        entry,
        detail: {
          observations: [observation],
          detailTruncated: false,
          completeness: "complete",
          warnings: [],
        },
        error: null,
        loading: false,
        "onUpdate:open": () => undefined,
      },
      global: {
        stubs: {
          UModal: { template: "<div><slot name='body' /></div>" },
        },
      },
    });

    expect(wrapper.text()).toContain("Observed flow");
    expect(wrapper.text()).toContain("Proxy exchange");
    expect(wrapper.text()).toContain("Response size");
    expect(wrapper.text()).toContain("Response received");
    expect(wrapper.text()).toContain("300");
    expect(wrapper.text()).toContain("Recursion desired");
    expect(wrapper.text()).not.toContain("Not observed: terminal response");
    expect(wrapper.text()).not.toContain("Canonical raw projection");
    expect(wrapper.get('button[aria-label="Copy raw"]').text()).toContain("Copy raw");
    const rawMessage = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Raw message"]');
    expect(rawMessage.element.value).toBe(JSON.stringify(observation.raw, null, 2));
    expect(rawMessage.attributes("readonly")).toBeDefined();
    expect(rawMessage.attributes("spellcheck")).toBe("false");
    expect(rawMessage.attributes("wrap")).toBe("off");
    expect(rawMessage.attributes("rows")).toBe("6");
  });

  it("keeps pending remote detail separate from absence evidence", async () => {
    const wrapper = await mountSuspended(DnsDetailModal, {
      props: {
        open: true,
        entry: { ...entry, observations: [] },
        detail: null,
        error: null,
        loading: true,
        "onUpdate:open": () => undefined,
      },
      global: {
        stubs: {
          UModal: { template: "<div><slot name='body' /></div>" },
        },
      },
    });

    expect(wrapper.text()).toContain("Loading DNS observations…");
    expect(wrapper.text()).toContain("api.example.");
    expect(wrapper.text()).not.toContain("Observed flow");
    expect(wrapper.text()).not.toContain("Decoded fields");
    expect(wrapper.text()).not.toContain("Not observed: terminal response");

    await wrapper.setProps({ loading: false, error: "DNS detail query failed." });
    expect(wrapper.get('[role="alert"]').text()).toBe("DNS detail query failed.");
    expect(wrapper.text()).not.toContain("Observed flow");
  });

  it("renders related firewall evidence separately with explicit uncorrelated status", async () => {
    const wrapper = await mountSuspended(DnsDetailModal, {
      props: {
        open: true,
        entry,
        detail: {
          observations: [observation],
          relatedEvidence: [
            {
              id: "related-application-1",
              timestamp: "2026-07-12T08:30:10.000Z",
              source: "application-rule",
              matchBasis: "same firewall, client IP, FQDN, and -5s/+60s window",
              action: "Allow",
              queryName: "api.example.",
              targetUrl: "https://api.example/health",
              raw: { Category: "AZFWApplicationRule", Action: "Allow" },
            },
          ],
          relatedSources: [
            { source: "application-rule", availability: "available", truncated: false },
            {
              source: "flow-trace",
              availability: "forbidden",
              truncated: false,
              warning: "Related source query forbidden",
            },
            { source: "nat-rule", availability: "not-applicable", truncated: false },
          ],
          detailTruncated: false,
          completeness: "complete",
          warnings: [],
        },
        error: null,
        loading: false,
        "onUpdate:open": () => undefined,
      },
      global: {
        stubs: {
          UModal: { template: "<div><slot name='body' /></div>" },
        },
      },
    });

    expect(wrapper.text()).toContain("Nearby firewall evidence");
    expect(wrapper.text()).toContain("no explicit correlation ID");
    expect(wrapper.text()).toContain("not asserted to belong to this DNS transaction");
    expect(wrapper.text()).toContain("same firewall, client IP, FQDN, and -5s/+60s window");
    expect(wrapper.text()).toContain("Uncorrelated nearby evidence");
    expect(wrapper.text()).toContain("Related source query forbidden");
    expect(wrapper.text()).toContain("https://api.example/health");
    expect(wrapper.text()).toContain("not-applicable");
    expect(wrapper.text()).toContain("Observed flow");
  });

  it("labels transport-only evidence without claiming DNS resolution", async () => {
    const transport = {
      ...observation,
      id: "transport-1",
      source: "network-rule" as const,
      stage: "transport" as const,
      path: "direct" as const,
      outcome: "blocked" as const,
      action: "Deny",
      policy: "firewall-policy",
      ruleCollectionGroup: "dns-collection-group",
      ruleCollection: "dns-collection",
      rule: "deny-external-dns",
      queryName: undefined,
      queryType: undefined,
      serverIp: "168.63.129.16",
      serverPort: "53",
    };
    const wrapper = await mountSuspended(DnsDetailModal, {
      props: {
        open: true,
        entry: {
          ...entry,
          id: transport.id,
          queryName: undefined,
          queryType: undefined,
          path: "direct",
          outcome: "blocked",
          completeness: "partial",
          confidence: "uncorrelated",
          source: "network-rule",
          observations: [transport],
        },
        detail: {
          observations: [transport],
          detailTruncated: false,
          completeness: "partial",
          warnings: [],
        },
        error: null,
        loading: false,
        "onUpdate:open": () => undefined,
      },
      global: {
        stubs: {
          UModal: {
            props: ["title"],
            template: "<div><h2>{{ title }}</h2><slot name='body' /></div>",
          },
        },
      },
    });

    expect(wrapper.text()).toContain("DNS transport detail");
    expect(wrapper.text()).toContain("Not observed");
    expect(wrapper.text()).toContain("168.63.129.16:53");
    expect(wrapper.findAll("dt").map((label) => label.text())).toEqual(
      expect.arrayContaining([
        "Firewall policy",
        "Rule collection group",
        "Rule collection",
        "Rule",
      ]),
    );
    expect(wrapper.text()).toContain("firewall-policy");
    expect(wrapper.text()).toContain("dns-collection-group");
    expect(wrapper.text()).toContain("dns-collection");
    expect(wrapper.text()).toContain("deny-external-dns");
    expect(wrapper.text()).not.toContain("DNS resolution detail");
  });
});
