<script setup lang="ts">
const runtimeConfig = useRuntimeConfig();
const anonymousMode = useAnonymousMode();
const { loggedIn, logout, user } = useOidcAuth();

const identityLabel = computed(() => {
  if (anonymousMode.enabled.value) {
    return "Temporary session";
  }

  const profile = user.value;
  if (profile && typeof profile === "object") {
    const claims = profile as unknown as Record<string, unknown>;
    const preferredUsername = claims.preferred_username;
    const email = claims.email;
    const name = claims.name;

    if (typeof preferredUsername === "string") {
      return preferredUsername;
    }
    if (typeof email === "string") {
      return email;
    }
    if (typeof name === "string") {
      return name;
    }
  }

  return loggedIn.value ? "Authenticated" : "Not signed in";
});

async function leave() {
  if (anonymousMode.enabled.value) {
    anonymousMode.stop();
    await navigateTo("/login");
    return;
  }

  await logout("entra", "/login");
}
</script>

<template>
  <div
    class="flex h-dvh flex-col overflow-hidden bg-brand-gray-50 text-brand-gray-950 dark:bg-brand-gray-950 dark:text-brand-gray-50"
  >
    <header
      class="shrink-0 border-b border-brand-gray-200 bg-white dark:border-brand-gray-800 dark:bg-brand-gray-900"
    >
      <div class="flex h-14 items-center justify-between px-4">
        <div class="flex items-center gap-3">
          <div class="grid size-8 place-items-center rounded-md bg-brand-blue-600 text-white">
            <UIcon name="i-lucide-shield" class="size-4" />
          </div>
          <div>
            <p class="text-sm font-semibold">{{ runtimeConfig.public.siteName }}</p>
            <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
              Firewall log receiver
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="hidden text-xs text-brand-gray-600 dark:text-brand-gray-300 sm:inline">
            {{ identityLabel }}
          </span>
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-log-out"
            aria-label="Leave"
            @click="leave"
          />
        </div>
      </div>
    </header>
    <main class="min-h-0 flex-1">
      <slot />
    </main>
  </div>
</template>
