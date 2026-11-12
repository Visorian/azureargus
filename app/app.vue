<template>
  <UApp :toaster="{ position: 'bottom-right' }">
    <NuxtLayout>
      <NuxtPage :keepalive="{ include: 'FirewallSimulatorPage' }" />
    </NuxtLayout>
  </UApp>
</template>
