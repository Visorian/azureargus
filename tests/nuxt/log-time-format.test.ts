import { mountSuspended } from "@nuxt/test-utils/runtime";
import { clearNuxtState } from "#app";
import { defineComponent } from "vue";

import {
  LOG_TIME_FORMAT_STORAGE_KEY,
  LOG_TIME_ZONE_STORAGE_KEY,
  useLogTimeFormat,
} from "../../app/composables/useLogTimeFormat";

const TimeFormatHarness = defineComponent({
  setup() {
    const { formatTimestamp, hourCycle, lastError, timeZone, use12Hour, useLocalTime } =
      useLogTimeFormat();
    return { formatTimestamp, hourCycle, lastError, timeZone, use12Hour, useLocalTime };
  },
  template: `
    <button aria-label="Toggle hour cycle" type="button" @click="use12Hour = !use12Hour">
      {{ hourCycle }}
    </button>
    <button aria-label="Toggle time zone" type="button" @click="useLocalTime = !useLocalTime">
      {{ timeZone }}
    </button>
    <output>{{ formatTimestamp("2026-07-21T12:09:24.536Z") }}</output>
    <p v-if="lastError" role="alert">{{ lastError }}</p>
  `,
});

describe("useLogTimeFormat", () => {
  let unmountWrapper: (() => void) | undefined;
  const defaultResolvedOptions = new Intl.DateTimeFormat().resolvedOptions();

  const clearTimeFormatState = () => {
    window.localStorage.removeItem(LOG_TIME_FORMAT_STORAGE_KEY);
    window.localStorage.removeItem(LOG_TIME_ZONE_STORAGE_KEY);
    clearNuxtState([
      "log-time-format",
      "log-time-zone",
      "log-browser-time-zone",
      "log-time-format-error",
    ]);
  };

  function mockBrowserTimeZone(timeZone: string) {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...defaultResolvedOptions,
      timeZone,
    });
  }

  beforeEach(() => {
    clearTimeFormatState();
  });

  afterEach(() => {
    unmountWrapper?.();
    unmountWrapper = undefined;
    vi.restoreAllMocks();
    clearTimeFormatState();
  });

  it("defaults to UTC and a 24-hour clock", async () => {
    mockBrowserTimeZone("America/Los_Angeles");
    const wrapper = await mountSuspended(TimeFormatHarness);
    unmountWrapper = () => wrapper.unmount();

    expect(wrapper.get('[aria-label="Toggle hour cycle"]').text()).toBe("h23");
    expect(wrapper.get('[aria-label="Toggle time zone"]').text()).toBe("UTC");
    expect(wrapper.get("output").text()).toBe("Jul 21, 2026, 12:09:24.536");
  });

  it("loads stored hour-cycle and local-time preferences", async () => {
    mockBrowserTimeZone("America/Los_Angeles");
    window.localStorage.setItem(LOG_TIME_FORMAT_STORAGE_KEY, "12-hour");
    window.localStorage.setItem(LOG_TIME_ZONE_STORAGE_KEY, "local");
    const wrapper = await mountSuspended(TimeFormatHarness);
    unmountWrapper = () => wrapper.unmount();

    expect(wrapper.get('[aria-label="Toggle hour cycle"]').text()).toBe("h12");
    expect(wrapper.get('[aria-label="Toggle time zone"]').text()).toBe("America/Los_Angeles");
    expect(wrapper.get("output").text()).toBe("Jul 21, 2026, 05:09:24.536 AM");
  });

  it("toggles and persists hour cycle and time zone independently", async () => {
    mockBrowserTimeZone("America/Los_Angeles");
    const wrapper = await mountSuspended(TimeFormatHarness);
    unmountWrapper = () => wrapper.unmount();

    await wrapper.get('[aria-label="Toggle time zone"]').trigger("click");

    expect(wrapper.get('[aria-label="Toggle time zone"]').text()).toBe("America/Los_Angeles");
    expect(wrapper.get('[aria-label="Toggle hour cycle"]').text()).toBe("h23");
    expect(window.localStorage.getItem(LOG_TIME_ZONE_STORAGE_KEY)).toBe("local");

    await wrapper.get('[aria-label="Toggle hour cycle"]').trigger("click");

    expect(wrapper.get('[aria-label="Toggle hour cycle"]').text()).toBe("h12");
    expect(wrapper.get('[aria-label="Toggle time zone"]').text()).toBe("America/Los_Angeles");
    expect(window.localStorage.getItem(LOG_TIME_FORMAT_STORAGE_KEY)).toBe("12-hour");
    expect(wrapper.get("output").text()).toBe("Jul 21, 2026, 05:09:24.536 AM");

    await wrapper.get('[aria-label="Toggle time zone"]').trigger("click");

    expect(wrapper.get('[aria-label="Toggle time zone"]').text()).toBe("UTC");
    expect(wrapper.get('[aria-label="Toggle hour cycle"]').text()).toBe("h12");
    expect(window.localStorage.getItem(LOG_TIME_ZONE_STORAGE_KEY)).toBe("utc");
    expect(wrapper.get("output").text()).toBe("Jul 21, 2026, 12:09:24.536 PM");
  });

  it("reports browser-storage read failures through the shared display error", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const wrapper = await mountSuspended(TimeFormatHarness);
    unmountWrapper = () => wrapper.unmount();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Display preferences could not be read from browser storage.",
    );
  });

  it("reports browser-storage write failures through the shared display error", async () => {
    const wrapper = await mountSuspended(TimeFormatHarness);
    unmountWrapper = () => wrapper.unmount();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await wrapper.get('[aria-label="Toggle time zone"]').trigger("click");

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Display preferences could not be saved in browser storage.",
    );
  });
});
