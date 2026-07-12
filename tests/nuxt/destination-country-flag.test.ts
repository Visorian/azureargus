import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick, reactive } from "vue";

import DestinationCountryFlag from "../../app/components/DestinationCountryFlag.vue";
import type { IpCountryLookupClient } from "../../app/composables/useIpCountryLookup";

function createLookup() {
  const cache = reactive(new Map<string, string | null>());
  const lookup: IpCountryLookupClient = {
    dispose: vi.fn(),
    getCountryCode: (ip) => (ip ? cache.get(ip) : undefined),
    queue: vi.fn(),
  };
  return { cache, lookup };
}

describe("DestinationCountryFlag", () => {
  it("reserves space and follows destination prop changes without showing stale flags", async () => {
    const { cache, lookup } = createLookup();
    const wrapper = await mountSuspended(DestinationCountryFlag, {
      props: { destination: "1.1.1.1", lookup },
    });
    const flag = wrapper.get("span");

    expect(lookup.queue).toHaveBeenCalledWith("1.1.1.1");
    expect(flag.classes()).toContain("w-5");
    expect(flag.text()).toBe("");
    expect(flag.attributes("aria-hidden")).toBe("true");

    cache.set("1.1.1.1", "DE");
    await nextTick();
    expect(flag.text()).toBe("🇩🇪");
    expect(flag.attributes("aria-label")).toBe("GeoIP country: Germany (DE)");

    await wrapper.setProps({ destination: "8.8.8.8" });
    expect(lookup.queue).toHaveBeenLastCalledWith("8.8.8.8");
    expect(flag.text()).toBe("");
    expect(flag.attributes("role")).toBeUndefined();

    cache.set("1.1.1.1", "US");
    await nextTick();
    expect(flag.text()).toBe("");

    cache.set("8.8.8.8", "US");
    await nextTick();
    expect(flag.text()).toBe("🇺🇸");
    expect(flag.attributes("aria-label")).toBe("GeoIP country: United States (US)");
  });
});
