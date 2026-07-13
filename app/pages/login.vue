<script setup lang="ts">
definePageMeta({
  layout: "login",
  oidcAuth: false,
});

const { loggedIn, login } = useOidcAuth();
const signingIn = ref(false);

watch(
  loggedIn,
  async (isLoggedIn) => {
    if (isLoggedIn) {
      await navigateTo("/logs");
    }
  },
  { immediate: true },
);

async function startLogin() {
  signingIn.value = true;
  try {
    await login("entra");
  } finally {
    signingIn.value = false;
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="space-y-1">
        <h1 class="text-lg font-semibold">Azure Argus</h1>
        <p class="text-sm text-muted">Sign in to use configured data sources.</p>
      </div>
    </template>

    <div class="space-y-3">
      <UButton
        block
        color="primary"
        icon="i-lucide-log-in"
        label="Sign in with Entra"
        :loading="signingIn"
        @click="startLogin"
      />
    </div>
  </UCard>
</template>
