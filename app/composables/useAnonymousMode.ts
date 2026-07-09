export function useAnonymousMode() {
  const enabled = useState("anonymous-mode-enabled", () => false);
  const runtimeConfig = useRuntimeConfig();

  function start() {
    if (!runtimeConfig.public.allowAnonymousMode) {
      return false;
    }

    enabled.value = true;
    return true;
  }

  function stop() {
    enabled.value = false;
  }

  return {
    enabled,
    start,
    stop,
  };
}
