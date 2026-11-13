export function useLogsSettingsDrawer() {
  const open = ref(false)
  let returnTarget: HTMLElement | null = null
  function show(trigger?: Event | HTMLElement) {
    if (trigger instanceof HTMLElement) {
      returnTarget = trigger
    } else if (trigger?.currentTarget instanceof HTMLElement) {
      returnTarget = trigger.currentTarget
    } else {
      returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    open.value = true
  }
  function restore(event: Event) {
    event.preventDefault()
    const target = returnTarget?.isConnected
      ? returnTarget
      : document.querySelector<HTMLElement>('#logs-settings-toggle')
    target?.focus()
  }
  return { open, show, restore }
}
