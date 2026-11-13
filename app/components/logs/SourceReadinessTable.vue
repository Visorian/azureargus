<script setup lang="ts">
import type { DnsSourceReadiness } from '#shared/types/dns'
import type { DnsReadinessStatus } from '~/composables/useDnsSourceReadiness'
import { getReadinessGroups, READINESS_COLUMNS } from '~/utils/logAnalyticsReadiness'

const props = defineProps<{ readiness: DnsSourceReadiness[]; status: DnsReadinessStatus }>()
const groups = computed(() => getReadinessGroups(props.readiness, props.status))
</script>

<template>
  <table class="readiness-table">
    <caption class="sr-only">
      Source availability in dedicated tables and AzureDiagnostics
    </caption>
    <thead>
      <tr>
        <th scope="col">Source</th>
        <th v-for="column in READINESS_COLUMNS" :key="column.storage" scope="col">
          {{ column.label }}
        </th>
      </tr>
    </thead>
    <tbody v-for="group in groups" :key="group.label">
      <tr>
        <th colspan="3" scope="rowgroup" class="readiness-group">{{ group.label }}</th>
      </tr>
      <tr v-for="item in group.items" :key="item.label">
        <th scope="row">
          <span>{{ item.label }}</span>
          <span class="readiness-mapping">{{ item.mapping }}</span>
        </th>
        <td v-for="indicator in item.indicators" :key="indicator.storage">
          <AppStatusLabel
            :tone="indicator.tone"
            :label="indicator.label"
            :icon="
              indicator.state === 'missing'
                ? 'i-lucide-circle-slash'
                : indicator.state === 'empty'
                  ? 'i-lucide-circle-minus'
                  : indicator.state === 'checking'
                    ? 'i-lucide-loader-circle'
                    : indicator.state === 'unchecked'
                      ? 'i-lucide-circle-dashed'
                      : indicator.state === 'forbidden'
                        ? 'i-lucide-lock-keyhole'
                        : undefined
            "
          />
        </td>
      </tr>
    </tbody>
  </table>
</template>
