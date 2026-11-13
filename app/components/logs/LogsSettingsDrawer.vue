<script setup lang="ts">
import visorianNegative from '~/assets/img/visorian-negative.svg'
import visorianPositive from '~/assets/img/visorian-positive.svg'

const open = defineModel<boolean>('open', { required: true })
const use12Hour = defineModel<boolean>('use12Hour', { required: true })
const useLocal = defineModel<boolean>('useLocal', { required: true })
defineProps<{ browserTimeZone: string; timeFormatError: string | null }>()
const emit = defineEmits<{ closeAutoFocus: [event: Event] }>()
defineSlots<{ default: () => unknown }>()
const config = useAppConfig()
const cycle = computed({
  get: () => (use12Hour.value ? '12' : '24'),
  set: (value: string) => {
    use12Hour.value = value === '12'
  },
})
const zone = computed({
  get: () => (useLocal.value ? 'local' : 'utc'),
  set: (value: string) => {
    useLocal.value = value === 'local'
  },
})
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Settings"
    :content="{ onCloseAutoFocus: (event) => emit('closeAutoFocus', event) }"
  >
    <template #body>
      <div id="logs-settings-drawer" class="touch-fields space-y-5">
        <slot />
        <section
          class="settings-section settings-section-divider"
          aria-labelledby="display-settings-title"
        >
          <h3 id="display-settings-title" class="text-base font-semibold">Display settings</h3>
          <div class="flex flex-wrap gap-4">
            <AppSegmentedControl
              v-model="cycle"
              label="Time format"
              :items="[
                { value: '24', label: '24-hour' },
                { value: '12', label: '12-hour' },
              ]"
            /><AppSegmentedControl
              v-model="zone"
              label="Time zone"
              :items="[
                { value: 'utc', label: 'UTC' },
                { value: 'local', label: 'Local' },
              ]"
            />
          </div>
          <p class="text-xs text-muted">
            Local time uses {{ browserTimeZone }}. Preferences are saved in this browser.
          </p>
          <AppNotice
            v-if="timeFormatError"
            tone="error"
            title="Could not save display settings"
            :description="timeFormatError"
          />
        </section>
        <footer class="settings-footer">
          <p>
            Version {{ config.versionNumber }} by
            <a href="https://www.visorian.com" target="_blank" rel="noopener noreferrer"
              ><img :src="visorianPositive" alt="" class="h-3 w-auto dark:hidden" /><img
                :src="visorianNegative"
                alt=""
                class="hidden h-3 w-auto dark:inline"
              />Visorian</a
            >
          </p>
          <p>
            IP geolocation by
            <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">DB-IP</a>
          </p>
        </footer>
      </div>
    </template>
  </USlideover>
</template>
