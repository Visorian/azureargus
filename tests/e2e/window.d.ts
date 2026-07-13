interface Window {
  useNuxtApp?: () => {
    payload: {
      state: Record<string, unknown>;
    };
  };
}
