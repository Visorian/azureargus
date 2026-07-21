import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent } from "vue";

import {
  LOG_TIME_FORMAT_STORAGE_KEY,
  useLogTimeFormat,
} from "../../app/composables/useLogTimeFormat";

const TimeFormatHarness = defineComponent({
  setup() {
    const { hourCycle, use12Hour } = useLogTimeFormat();
    return { hourCycle, use12Hour };
  },
  template: '<button type="button" @click="use12Hour = !use12Hour">{{ hourCycle }}</button>',
});

describe("useLogTimeFormat", () => {
  it("loads and persists the browser-local hour cycle", async () => {
    window.localStorage.setItem(LOG_TIME_FORMAT_STORAGE_KEY, "12-hour");
    const wrapper = await mountSuspended(TimeFormatHarness);

    expect(wrapper.get("button").text()).toBe("h12");

    await wrapper.get("button").trigger("click");

    expect(wrapper.get("button").text()).toBe("h23");
    expect(window.localStorage.getItem(LOG_TIME_FORMAT_STORAGE_KEY)).toBe("24-hour");
  });
});
