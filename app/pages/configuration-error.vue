<script setup lang="ts">
definePageMeta({
  layout: "login",
  oidcAuth: false,
});

const deployment = useDeploymentCapabilities();
const retrying = ref(false);
const errors = computed(() => deployment.capabilities.value?.errors ?? []);

onMounted(() => {
  if (deployment.capabilities.value === null && deployment.status.value === "idle") {
    void deployment.load().catch(() => undefined);
  }
});

async function retry() {
  retrying.value = true;
  try {
    const capabilities = await deployment.load(true);
    if (capabilities.mode !== "invalid") {
      await navigateTo(capabilities.mode === "anonymous" ? "/logs" : "/login");
    }
  } catch {
    // Error state is exposed by composable.
  } finally {
    retrying.value = false;
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="space-y-1">
        <h1 class="text-lg font-semibold">Deployment configuration unavailable</h1>
        <p class="text-sm text-muted">Azure Argus cannot determine a safe authentication mode.</p>
      </div>
    </template>

    <div class="space-y-3">
      <ul v-if="errors.length > 0" class="list-disc space-y-1 pl-5 text-sm" role="alert">
        <li v-for="error in errors" :key="error.code">{{ error.message }}</li>
      </ul>
      <p v-else class="text-sm" role="alert">
        {{ deployment.lastError.value ?? "Deployment configuration could not be loaded." }}
      </p>
      <UButton label="Retry" icon="i-lucide-refresh-cw" :loading="retrying" @click="retry" />
    </div>
  </UCard>
</template>
