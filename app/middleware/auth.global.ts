export default defineNuxtRouteMiddleware((to) => {
  if (to.path === "/login" || to.meta.oidcAuth === false) {
    return;
  }

  const { loggedIn } = useOidcAuth();
  const anonymousMode = useAnonymousMode();
  const runtimeConfig = useRuntimeConfig();

  if (loggedIn.value || (runtimeConfig.public.allowAnonymousMode && anonymousMode.enabled.value)) {
    return;
  }

  return navigateTo("/login");
});
