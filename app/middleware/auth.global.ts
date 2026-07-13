export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/configuration-error") {
    return;
  }

  const deployment = useDeploymentCapabilities();
  let capabilities;
  try {
    capabilities = await deployment.load();
  } catch {
    return navigateTo("/configuration-error");
  }

  if (capabilities.mode === "invalid") {
    return navigateTo("/configuration-error");
  }
  if (capabilities.mode === "anonymous") {
    return to.path === "/login" ? navigateTo("/logs") : undefined;
  }

  const { loggedIn } = useOidcAuth();
  if (to.path === "/login" || to.meta.oidcAuth === false || loggedIn.value) {
    return;
  }

  return navigateTo("/login");
});
