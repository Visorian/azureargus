<script setup lang="ts">
definePageMeta({
  layout: 'login',
  oidcAuth: false,
})

const { error, pending, signIn } = useSignIn()

useHead({ title: 'Sign in · Azure Argus' })
</script>

<template>
  <AppStatusCard title="Azure Argus" description="Sign in to use configured data sources.">
    <template v-if="error" #default>
      <AppNotice tone="error" title="Sign-in unavailable" :description="error" />
    </template>
    <template #actions>
      <UButton
        block
        color="primary"
        :icon="pending ? 'i-lucide-loader-circle' : 'i-lucide-log-in'"
        label="Sign in with Entra"
        :aria-disabled="pending"
        :aria-busy="pending"
        @click="signIn"
      />
    </template>
  </AppStatusCard>
</template>
