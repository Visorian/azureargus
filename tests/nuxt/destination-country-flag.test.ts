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
    setActive: vi.fn(),
  };
  return { cache, lookup };
}

describe("DestinationCountryFlag", () => {
  it("renders an internal-address icon and skips GeoIP lookup for RFC 1918 destinations", async () => {
    const { lookup } = createLookup();
    const wrapper = await mountSuspended(DestinationCountryFlag, {
      props: { destination: "10.140.16.133", lookup },
    });
    const indicator = wrapper.get("span");

    expect(lookup.queue).not.toHaveBeenCalled();
    expect(indicator.attributes("aria-label")).toBe("Internal address (RFC 1918)");
    expect(indicator.attributes("title")).toBe("Internal address (RFC 1918)");
    expect(indicator.attributes("role")).toBe("img");
    expect(wrapper.getComponent({ name: "UIcon" }).props("name")).toBe("i-lucide-network");

    await wrapper.setProps({ destination: "8.8.8.8" });
    expect(lookup.queue).toHaveBeenCalledWith("8.8.8.8");
    expect(indicator.attributes("aria-label")).toBeUndefined();
    expect(wrapper.findComponent({ name: "UIcon" }).exists()).toBe(false);
  });

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
