<script setup lang="ts">
import { identityLabel } from '~/utils/identityLabel'

const runtimeConfig = useRuntimeConfig()
const deployment = useDeploymentCapabilities()
const { loggedIn, logout, user } = useOidcAuth()
const managed = computed(() => deployment.capabilities.value?.mode === 'managed')
const identity = computed(() =>
  managed.value ? identityLabel(user.value, loggedIn.value) : 'Temporary session',
)
const identityOpen = ref(false)

async function leave() {
  if (managed.value) {
    await logout('entra', '/login')
  }
}
</script>

<template>
  <header :aria-label="runtimeConfig.public.siteName" class="app-header">
    <div class="app-header-inner">
      <NuxtLink to="/logs" class="app-brand" :aria-label="runtimeConfig.public.siteName">
        <span class="app-brand-mark"><UIcon name="i-lucide-shield" class="size-4" /></span>
        <span>{{ runtimeConfig.public.siteName }}</span>
      </NuxtLink>
      <nav aria-label="Main navigation" class="app-route-nav">
        <NuxtLink
          to="/logs"
          class="app-route-link"
          :aria-current="$route.path === '/logs' ? 'page' : undefined"
          >Logs &amp; DNS</NuxtLink
        >
        <NuxtLink
          to="/firewall-simulator"
          class="app-route-link"
          :aria-current="$route.path === '/firewall-simulator' ? 'page' : undefined"
          >Rule simulator</NuxtLink
        >
      </nav>
      <div class="app-header-actions">
        <UTooltip v-model:open="identityOpen" :text="identity" disable-closing-trigger>
          <button
            type="button"
            class="app-identity"
            :aria-label="`Session identity: ${identity}`"
            @click="identityOpen = !identityOpen"
          >
            {{ identity }}
          </button>
        </UTooltip>
        <AppThemeToggle />
        <UTooltip v-if="managed" text="Sign out">
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-log-out"
            aria-label="Sign out"
            class="app-icon-button"
            @click="leave"
          />
        </UTooltip>
      </div>
    </div>
  </header>
</template>
