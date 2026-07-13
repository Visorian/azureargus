export function useAnonymousMode() {
  const deployment = useDeploymentCapabilities();
  const enabled = computed(() => deployment.capabilities.value?.mode === "anonymous");

  return {
    enabled,
  };
}
