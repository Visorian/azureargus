<script setup lang="ts">
import type { AnalysisMode } from '~/composables/useAnalysisMode'

defineProps<{
  logAnalysis: boolean
  lens: 'all-logs' | 'dns-troubleshooting'
  eventHubAvailable: boolean
  logAnalyticsAvailable: boolean
  logAnalyticsRequirement: string | null
  transitioning: boolean
}>()
const emit = defineEmits<{
  mode: [mode: AnalysisMode, event: MouseEvent]
  lens: [lens: 'all-logs' | 'dns-troubleshooting']
  settings: [returnTarget: HTMLElement | undefined]
}>()
const open = ref(false)

function selectMode(mode: AnalysisMode, event: MouseEvent) {
  emit('mode', mode, event)
  open.value = false
}

function selectLens(lens: 'all-logs' | 'dns-troubleshooting') {
  emit('lens', lens)
  open.value = false
}

async function openSettings() {
  open.value = false
  await nextTick()
  emit('settings', document.querySelector<HTMLElement>('#logs-workspace-menu') ?? undefined)
}
</script>

<template>
  <div class="workspace-menu fixed z-40">
    <UPopover
      v-model:open="open"
      :content="{ side: 'top', align: 'end', sideOffset: 10, collisionPadding: 16 }"
      :ui="{
        content:
          'z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl shadow-xl motion-reduce:animate-none',
      }"
    >
      <UButton
        id="logs-workspace-menu"
        :icon="open ? 'i-lucide-x' : 'i-lucide-menu'"
        label="Menu"
        aria-label="Workspace menu"
        color="neutral"
        variant="outline"
        class="min-h-12 gap-2 rounded-lg px-4 shadow-lg"
      />
      <template #content>
        <nav aria-label="Workspace" class="max-h-[calc(100dvh-10rem)] overflow-y-auto p-2">
          <div class="space-y-1 p-1">
            <UButton
              icon="i-lucide-list"
              label="All logs"
              :trailing-icon="lens === 'all-logs' ? 'i-lucide-check' : undefined"
              :aria-pressed="lens === 'all-logs'"
              :color="lens === 'all-logs' ? 'primary' : 'neutral'"
              :variant="lens === 'all-logs' ? 'soft' : 'ghost'"
              block
              class="min-h-12 justify-start gap-3 px-3 [&_[data-slot=trailingIcon]]:ml-auto"
              @click="selectLens('all-logs')"
            />
            <UButton
              icon="i-lucide-network"
              label="DNS troubleshooting"
              :trailing-icon="lens === 'dns-troubleshooting' ? 'i-lucide-check' : undefined"
              :aria-pressed="lens === 'dns-troubleshooting'"
              :color="lens === 'dns-troubleshooting' ? 'primary' : 'neutral'"
              :variant="lens === 'dns-troubleshooting' ? 'soft' : 'ghost'"
              block
              class="min-h-12 justify-start gap-3 px-3 [&_[data-slot=trailingIcon]]:ml-auto"
              @click="selectLens('dns-troubleshooting')"
            />
          </div>
          <section
            aria-labelledby="mobile-data-source"
            class="my-2 border-y border-default px-1 py-3"
          >
            <h2 id="mobile-data-source" class="mb-2 px-3 text-xs font-medium text-muted">
              Data source
            </h2>
            <div class="space-y-1">
              <UButton
                icon="i-lucide-radio"
                label="Live Event Hub"
                :trailing-icon="!logAnalysis ? 'i-lucide-check' : undefined"
                :aria-pressed="!logAnalysis"
                :disabled="!eventHubAvailable || transitioning"
                :aria-describedby="!eventHubAvailable ? 'mobile-event-hub-requirement' : undefined"
                :color="!logAnalysis ? 'primary' : 'neutral'"
                :variant="!logAnalysis ? 'soft' : 'ghost'"
                block
                class="min-h-12 justify-start gap-3 px-3 [&_[data-slot=trailingIcon]]:ml-auto"
                @click="selectMode('real-time-analysis', $event)"
              />
              <p
                v-if="!eventHubAvailable"
                id="mobile-event-hub-requirement"
                class="px-3 text-xs text-muted"
              >
                Live Event Hub is not configured.
              </p>
              <UButton
                icon="i-lucide-chart-no-axes-combined"
                label="Log Analytics"
                :trailing-icon="logAnalysis ? 'i-lucide-check' : undefined"
                :aria-pressed="logAnalysis"
                :disabled="!logAnalyticsAvailable || transitioning"
                :aria-describedby="
                  logAnalyticsRequirement ? 'mobile-log-analytics-requirement' : undefined
                "
                :color="logAnalysis ? 'primary' : 'neutral'"
                :variant="logAnalysis ? 'soft' : 'ghost'"
                block
                class="min-h-12 justify-start gap-3 px-3 [&_[data-slot=trailingIcon]]:ml-auto"
                @click="selectMode('log-analysis', $event)"
              />
              <p
                v-if="logAnalyticsRequirement"
                id="mobile-log-analytics-requirement"
                class="px-3 text-xs text-muted"
              >
                {{ logAnalyticsRequirement }}
              </p>
            </div>
          </section>
          <UButton
            icon="i-lucide-settings"
            label="Settings"
            color="neutral"
            variant="ghost"
            block
            class="min-h-12 justify-start gap-3 px-4"
            @click="openSettings"
          />
        </nav>
      </template>
    </UPopover>
  </div>
</template>
