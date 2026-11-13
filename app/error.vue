<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

useHead(() => ({
  title:
    props.error.statusCode === 404
      ? 'Page not found · Azure Argus'
      : 'Page unavailable · Azure Argus',
}))

function returnToLogs() {
  void clearError({ redirect: '/logs' })
}
</script>

<template>
  <UApp>
    <NuxtLayout name="login">
      <AppStatusCard
        :title="error.statusCode === 404 ? 'Page not found' : 'Page unavailable'"
        :description="
          error.statusCode === 404
            ? 'This page does not exist.'
            : 'Azure Argus could not open this page. Try opening logs again.'
        "
      >
        <template #actions>
          <UButton label="Open logs" icon="i-lucide-arrow-left" @click="returnToLogs" />
        </template>
      </AppStatusCard>
    </NuxtLayout>
  </UApp>
</template>
