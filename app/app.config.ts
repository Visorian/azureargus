const control =
  'app-control rounded-md bg-default ring-accented text-default placeholder:text-dimmed'

export default defineAppConfig({
  ui: {
    colors: { primary: 'brand-blue', neutral: 'brand-gray' },
    button: {
      slots: { base: 'app-button rounded-md font-semibold shadow-none' },
      defaultVariants: { size: 'lg' },
      compoundVariants: [
        {
          color: 'error',
          variant: 'solid',
          class: 'bg-error text-inverted hover:bg-error active:bg-error',
        },
        {
          color: 'primary',
          variant: 'solid',
          class:
            'app-button-primary bg-primary text-inverted hover:bg-primary/90 active:bg-primary/85 disabled:bg-primary aria-disabled:bg-primary outline-primary focus-visible:outline-2',
        },
        {
          color: 'neutral',
          variant: 'outline',
          class:
            'bg-default text-default ring-accented hover:bg-muted active:bg-elevated outline-primary focus-visible:outline-2',
        },
        {
          color: 'neutral',
          variant: 'ghost',
          class:
            'text-muted hover:bg-muted hover:text-highlighted active:bg-elevated outline-primary focus-visible:outline-2',
        },
      ],
    },
    input: { slots: { base: control }, defaultVariants: { size: 'lg' } },
    textarea: { slots: { base: `${control} font-mono text-sm` }, defaultVariants: { size: 'lg' } },
    inputNumber: { slots: { base: control }, defaultVariants: { size: 'lg' } },
    select: {
      slots: { base: control, content: 'touch-fields z-60 rounded-md shadow-none ring-default' },
      defaultVariants: { size: 'lg' },
    },
    selectMenu: {
      slots: { base: control, content: 'touch-fields z-60 rounded-md shadow-none ring-default' },
      defaultVariants: { size: 'lg' },
    },
    formField: {
      slots: {
        root: 'min-w-0',
        label: 'text-sm font-medium text-default',
        description: 'mt-1 text-xs text-muted',
        help: 'mt-1 text-xs text-muted',
        error: 'mt-1 text-xs text-error',
      },
      defaultVariants: { size: 'lg' },
    },
    switch: {
      slots: { base: 'app-switch', thumb: 'shadow-none' },
    },
    checkbox: {
      slots: {
        root: 'app-checkbox',
        base: 'ring-accented',
        label: 'text-sm text-default',
        description: 'mt-1 text-xs text-muted',
      },
    },
    tooltip: {
      slots: {
        content: 'app-tooltip z-60 h-auto rounded-md shadow-none',
        text: () => 'whitespace-normal wrap-anywhere',
      },
    },
    popover: { slots: { content: 'z-50 bg-default ring-default rounded-lg shadow-none' } },
    card: { slots: { root: 'rounded-lg shadow-none bg-default ring-default' } },
    alert: {
      slots: {
        root: 'rounded-lg shadow-none',
        title: 'font-semibold',
        description: 'text-sm opacity-100',
      },
      defaultVariants: { variant: 'outline' },
    },
    modal: {
      slots: {
        overlay: 'z-50',
        content: 'z-50 bg-default divide-default select-text',
        header: 'shrink-0 p-4 sm:px-4 pe-16 sm:pe-16 min-h-14 gap-2',
        wrapper: 'min-w-0 flex-1',
        body: 'min-h-0 overflow-auto p-4 sm:p-4 select-text',
        footer: 'shrink-0 p-4 sm:px-4 justify-end gap-2 flex-wrap',
        title: 'text-lg font-semibold text-highlighted',
        close: 'app-overlay-close',
      },
      variants: {
        overlay: { true: { overlay: 'bg-brand-gray-950/85' } },
        fullscreen: {
          false: {
            content: 'w-[calc(100vw-2rem)] max-w-3xl rounded-lg shadow-none ring ring-default',
          },
        },
      },
    },
    slideover: {
      slots: {
        overlay: 'z-50 bg-brand-gray-950/85',
        content: 'z-50 bg-default divide-default ring-default shadow-none sm:shadow-none',
        header: 'shrink-0 p-4 sm:px-4 pe-16 sm:pe-16 min-h-14 gap-2',
        wrapper: 'min-w-0 flex-1',
        body: 'min-h-0 overflow-auto p-4 sm:p-4',
        footer: 'shrink-0 p-4 sm:px-4 justify-end gap-2 flex-wrap',
        title: 'text-lg font-semibold text-highlighted',
        close: 'app-overlay-close',
      },
    },
  },
})
