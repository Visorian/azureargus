import { useEventListener, useMutationObserver } from '@vueuse/core'
import { computed, nextTick, ref, useId, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { RecycleScrollerExposed } from 'vue-virtual-scroller'

interface VirtualResultsNavigation<Item> {
  activeId: Ref<string | null>
  activeDescendant: ComputedRef<string | undefined>
  rowId: (id: string) => string
  updateRange: (first: number, last: number) => void
  focus: (id?: string) => void
  restore: (id: string) => void
  select: (item: Item) => void
  keydown: (event: KeyboardEvent) => void
  scrolled: () => void
}

export function useVirtualResultsNavigation<Item extends { id: string }>(
  items: Readonly<Ref<readonly Item[]>>,
  viewport: Readonly<Ref<HTMLElement | null>>,
  scroller: Readonly<Ref<RecycleScrollerExposed<Item> | null>>,
  columns: Readonly<Ref<number>>,
  open: (item: Item) => void,
): VirtualResultsNavigation<Item> {
  const prefix = useId()
  const activeId = ref<string | null>(null)
  const start = ref(0)
  const end = ref(0)
  const visibleStart = ref(0)
  const visibleEnd = ref(0)
  let controlToRestore: { row: string; label: string | null } | null = null
  const rowId = (id: string) => `${prefix}-result-${encodeURIComponent(id)}`
  const activeDescendant = computed(() => {
    const index = items.value.findIndex((item) => item.id === activeId.value)
    return index >= start.value && index < end.value && activeId.value !== null
      ? rowId(activeId.value)
      : undefined
  })

  function scrollBounds() {
    const element = viewport.value?.querySelector<HTMLElement>('.vue-recycle-scroller')
    if (!element) {
      return null
    }
    const rect = element.getBoundingClientRect()
    const header = viewport.value
      ?.querySelector<HTMLElement>('[role="columnheader"]')
      ?.parentElement?.getBoundingClientRect()
    return {
      element,
      top: Math.max(rect.top, header?.bottom ?? rect.top),
      bottom: rect.top + element.clientHeight,
    }
  }

  function updateVisible() {
    const bounds = scrollBounds()
    if (!bounds) {
      return
    }
    const list = bounds.element.querySelector<HTMLElement>('.vue-recycle-scroller__item-wrapper')
    const control = scroller.value
    if (!list || !control || items.value.length === 0) {
      return
    }
    const origin = list.getBoundingClientRect().top
    const top = bounds.top - origin
    const bottom = bounds.bottom - origin
    let first = control.findItemIndex(Math.max(0, top))
    let last = control.findItemIndex(Math.max(0, bottom - 1))
    if (control.getItemOffset(first) < top - 1) {
      first += columns.value
    }
    if (control.getItemOffset(last) + control.getItemSize(last) > bottom + 1) {
      last -= columns.value
    }
    if (first > last) {
      first = control.findItemIndex(Math.max(0, top))
      last = first
    }
    visibleStart.value = Math.max(0, first)
    visibleEnd.value = Math.min(
      items.value.length,
      Math.floor(last / columns.value) * columns.value + columns.value,
    )
    const index = items.value.findIndex((item) => item.id === activeId.value)
    if (index < visibleStart.value || index >= visibleEnd.value) {
      activeId.value = items.value[visibleStart.value]?.id ?? null
    }
  }

  function updateRange(first: number, last: number) {
    start.value = first
    end.value = last
    void nextTick(updateVisible)
  }

  function reveal(id: string) {
    const index = items.value.findIndex((item) => item.id === id)
    const bounds = scrollBounds()
    const list = bounds?.element.querySelector<HTMLElement>('.vue-recycle-scroller__item-wrapper')
    const control = scroller.value
    if (index === -1 || !bounds || !list || !control) {
      updateVisible()
      return
    }
    activeId.value = id
    const top = list.getBoundingClientRect().top + control.getItemOffset(index)
    const bottom = top + control.getItemSize(index)
    const delta = top < bounds.top ? top - bounds.top : Math.max(0, bottom - bounds.bottom)
    if (delta !== 0) {
      control.scrollToPosition(bounds.element.scrollTop + delta)
    }
    control.updateVisibleItems(true)
  }

  function focus(id?: string) {
    if (id !== undefined) {
      activeId.value = id
    } else if (!items.value.some((item) => item.id === activeId.value)) {
      activeId.value = items.value[visibleStart.value]?.id ?? null
    }
    viewport.value?.focus({ preventScroll: true })
  }

  function restore(id: string) {
    reveal(id)
    focus()
  }

  function select(item: Item) {
    focus(item.id)
    open(item)
  }

  function scrolled() {
    void nextTick(() => {
      const element = document.activeElement
      const row = element instanceof HTMLElement ? element.closest('[data-result-index]') : null
      const bounds = scrollBounds()
      const rect = row?.getBoundingClientRect()
      if (
        viewport.value?.contains(element) === true &&
        bounds &&
        rect &&
        (rect.top < bounds.top || rect.bottom > bounds.bottom)
      ) {
        viewport.value.focus({ preventScroll: true })
      }
      updateVisible()
    })
  }

  function keydown(event: KeyboardEvent) {
    if (event.target !== viewport.value) {
      return
    }
    const index = Math.max(
      0,
      items.value.findIndex((item) => item.id === activeId.value),
    )
    const page = Math.max(columns.value, visibleEnd.value - visibleStart.value - columns.value)
    let target: number
    switch (event.key) {
      case 'ArrowDown': {
        target = index + columns.value
        break
      }
      case 'ArrowUp': {
        target = index - columns.value
        break
      }
      case 'ArrowRight': {
        if (columns.value === 1) {
          return
        }
        target = index + 1
        break
      }
      case 'ArrowLeft': {
        if (columns.value === 1) {
          return
        }
        target = index - 1
        break
      }
      case 'Home': {
        target = 0
        break
      }
      case 'End': {
        target = items.value.length - 1
        break
      }
      case 'PageDown': {
        target = index + page
        break
      }
      case 'PageUp': {
        target = index - page
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const item = items.value[index]
        if (item && activeDescendant.value !== undefined) {
          open(item)
        }
        return
      }
      default: {
        return
      }
    }
    event.preventDefault()
    const item = items.value[Math.min(items.value.length - 1, Math.max(0, target))]
    if (item) {
      reveal(item.id)
    }
  }

  useEventListener(
    document,
    'pointerdown',
    () => {
      controlToRestore = null
    },
    { capture: true },
  )
  useEventListener(
    viewport,
    'keydown',
    (event) => {
      if (event.key === 'Tab') {
        controlToRestore = null
      }
    },
    { capture: true },
  )
  useEventListener(viewport, 'focusin', (event) => {
    const element = event.target
    const row = element instanceof HTMLElement ? element.closest('[data-result-index]') : null
    controlToRestore =
      row && element instanceof HTMLButtonElement
        ? { row: row.id, label: element.getAttribute('aria-label') }
        : null
  })
  useMutationObserver(
    viewport,
    () => {
      const control = controlToRestore
      const focused = document.activeElement
      const recycled =
        focused instanceof HTMLElement &&
        viewport.value?.contains(focused) === true &&
        focused.closest('[data-result-index]')?.id !== control?.row
      if (control !== null && (focused === document.body || recycled)) {
        const row = document.getElementById(control.row)
        const button = [...(row?.querySelectorAll('button') ?? [])].find(
          (candidate) => candidate.getAttribute('aria-label') === control.label,
        )
        button?.focus({ preventScroll: true })
      }
    },
    { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'aria-label'] },
  )

  watch(
    items,
    () => {
      const id = activeId.value
      const focused = document.activeElement
      const gridFocused = focused === viewport.value
      const rowControl =
        focused instanceof HTMLElement &&
        viewport.value?.contains(focused) === true &&
        focused.closest('[data-result-index]')
          ? focused
          : null
      if (id !== null && items.value.some((item) => item.id === id)) {
        if (gridFocused || rowControl) {
          void nextTick(() => {
            reveal(id)
          })
        }
      } else {
        void nextTick(updateVisible)
      }
    },
    { flush: 'sync' },
  )

  return {
    activeId,
    activeDescendant,
    rowId,
    updateRange,
    focus,
    restore,
    select,
    keydown,
    scrolled,
  }
}
