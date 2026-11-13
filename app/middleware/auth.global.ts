export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/configuration-error') {
    return
  }

  const deployment = useDeploymentCapabilities()
  let capabilities
  try {
    capabilities = await deployment.load()
  } catch {
    return await navigateTo('/configuration-error')
  }

  if (capabilities.mode === 'invalid') {
    return await navigateTo('/configuration-error')
  }
  if (capabilities.mode === 'anonymous') {
    return to.path === '/login' ? await navigateTo('/logs') : undefined
  }

  await useAuthSessionReady().load()
  const { loggedIn } = useOidcAuth()
  if (to.path === '/login') {
    return loggedIn.value ? await navigateTo('/logs') : undefined
  }
  if (to.meta['oidcAuth'] === false || loggedIn.value) {
    return
  }

  return await navigateTo('/login')
})
