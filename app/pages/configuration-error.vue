<script setup lang="ts">
definePageMeta({
  layout: 'login',
  oidcAuth: false,
})

const { checking, errors, feedback, retrying, unavailable, retry } = useConfigurationRecovery()

useHead({ title: 'Deployment configuration · Azure Argus' })
</script>

<template>
  <AppStatusCard
    :title="
      checking
        ? 'Checking deployment configuration'
        : unavailable
          ? 'Deployment configuration unavailable'
          : 'Configuration ready'
    "
    :description="
      checking
        ? 'Loading the application settings…'
        : unavailable
          ? 'Azure Argus cannot load its authentication configuration.'
          : 'Opening Azure Argus…'
    "
  >
    <p v-if="checking" role="status" class="text-sm text-muted">Checking configuration…</p>
    <AppNotice
      v-else-if="unavailable"
      tone="error"
      title="Configuration needs attention"
      :description="
        errors.length === 0
          ? 'Deployment configuration could not be loaded. Check the connection and retry.'
          : undefined
      "
    >
      <template v-if="errors.length > 0" #default>
        <ul class="status-error-list">
          <li v-for="error in errors" :key="error.code">{{ error.message }}</li>
        </ul>
      </template>
    </AppNotice>
    <p v-if="feedback" role="status" class="status-retry-feedback">{{ feedback }}</p>
    <template #actions>
      <UButton
        label="Retry"
        :icon="retrying ? 'i-lucide-loader-circle' : 'i-lucide-refresh-cw'"
        :aria-disabled="checking || retrying || !unavailable"
        :aria-busy="retrying"
        @click="retry"
      />
    </template>
  </AppStatusCard>
</template>
