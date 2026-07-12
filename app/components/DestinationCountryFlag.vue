<script setup lang="ts">
import { computed, watch } from "vue";

import type { IpCountryLookupClient } from "~/composables/useIpCountryLookup";
import { countryCodeToFlag, countryCodeToName } from "~/utils/countryFlag";
import { isRfc1918Ipv4Address } from "~/utils/ipAddress";

const props = defineProps<{
  destination?: string;
  lookup: IpCountryLookupClient;
}>();

watch(
  () => props.destination,
  (destination) => {
    if (!isRfc1918Ipv4Address(destination)) {
      props.lookup.queue(destination);
    }
  },
  { immediate: true },
);

const internal = computed(() => isRfc1918Ipv4Address(props.destination));
const countryCode = computed(() => props.lookup.getCountryCode(props.destination));
const flag = computed(() => countryCodeToFlag(countryCode.value));
const countryName = computed(() => countryCodeToName(countryCode.value));
const accessibleLabel = computed(() =>
  internal.value
    ? "Internal address (RFC 1918)"
    : countryName.value && countryCode.value
      ? `GeoIP country: ${countryName.value} (${countryCode.value})`
      : undefined,
);
</script>

<template>
  <span
    class="country-flag inline-flex w-5 shrink-0 items-center justify-center text-sm leading-none"
    :aria-hidden="!accessibleLabel"
    :aria-label="accessibleLabel"
    :role="accessibleLabel ? 'img' : undefined"
    :title="accessibleLabel"
  >
    <UIcon v-if="internal" name="i-lucide-network" class="size-4" />
    <template v-else>{{ flag }}</template>
  </span>
</template>

<style scoped>
.country-flag {
  font-family: emoji;
}
</style>
