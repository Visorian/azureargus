<script setup lang="ts">
import { computed, watch } from "vue";

import type { IpCountryLookupClient } from "~/composables/useIpCountryLookup";
import { countryCodeToFlag, countryCodeToName } from "~/utils/countryFlag";

const props = defineProps<{
  destination?: string;
  lookup: IpCountryLookupClient;
}>();

watch(
  () => props.destination,
  (destination) => props.lookup.queue(destination),
  { immediate: true },
);

const countryCode = computed(() => props.lookup.getCountryCode(props.destination));
const flag = computed(() => countryCodeToFlag(countryCode.value));
const countryName = computed(() => countryCodeToName(countryCode.value));
const accessibleLabel = computed(() =>
  countryName.value && countryCode.value
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
    {{ flag }}
  </span>
</template>

<style scoped>
.country-flag {
  font-family: emoji;
}
</style>
