export default defineAppConfig({
  ui: {
    colors: {
      primary: "brand-blue",
      neutral: "brand-gray",
    },
    button: {
      slots: {
        base: "rounded-md font-semibold",
      },
      compoundVariants: [
        {
          color: "primary",
          variant: "solid",
          class:
            "bg-brand-blue-600 text-white hover:bg-brand-blue-700 active:bg-brand-blue-700 disabled:bg-brand-blue-600 disabled:text-white disabled:opacity-90 dark:bg-brand-blue-500 dark:text-white dark:hover:bg-brand-blue-400 dark:active:bg-brand-blue-400",
        },
        {
          color: "neutral",
          variant: "outline",
          class:
            "bg-white text-brand-gray-800 ring-brand-gray-400 hover:bg-brand-gray-100 hover:text-brand-gray-950 active:bg-brand-gray-200 dark:bg-brand-gray-900 dark:text-brand-gray-100 dark:ring-brand-gray-600 dark:hover:bg-brand-gray-800 dark:hover:text-white",
        },
        {
          color: "neutral",
          variant: "ghost",
          class:
            "text-brand-gray-700 hover:bg-brand-gray-200 hover:text-brand-gray-950 active:bg-brand-gray-300 dark:text-brand-gray-200 dark:hover:bg-brand-gray-800 dark:hover:text-white",
        },
      ],
    },
    checkbox: {
      slots: {
        base: "ring-brand-gray-500 dark:ring-brand-gray-500",
        description: "mt-0.5 text-brand-gray-600 dark:text-brand-gray-300",
      },
    },
    input: {
      slots: {
        base: "bg-white ring-brand-gray-400 placeholder:text-brand-gray-500 hover:ring-brand-gray-500 dark:bg-brand-gray-900 dark:ring-brand-gray-600 dark:placeholder:text-brand-gray-400 dark:hover:ring-brand-gray-500",
      },
    },
    select: {
      slots: {
        base: "bg-white ring-brand-gray-400 hover:ring-brand-gray-500 dark:bg-brand-gray-900 dark:ring-brand-gray-600 dark:hover:ring-brand-gray-500",
        content: "ring-brand-gray-300 dark:ring-brand-gray-700",
      },
    },
    selectMenu: {
      slots: {
        base: "bg-white ring-brand-gray-400 hover:ring-brand-gray-500 dark:bg-brand-gray-900 dark:ring-brand-gray-600 dark:hover:ring-brand-gray-500",
        content: "ring-brand-gray-300 dark:ring-brand-gray-700",
      },
    },
    textarea: {
      slots: {
        base: "bg-white ring-brand-gray-400 placeholder:text-brand-gray-500 hover:ring-brand-gray-500 dark:bg-brand-gray-900 dark:ring-brand-gray-600 dark:placeholder:text-brand-gray-400 dark:hover:ring-brand-gray-500",
      },
    },
    card: {
      slots: {
        root: "rounded-lg",
      },
    },
    modal: {
      slots: {
        overlay: "z-50 bg-brand-gray-950/85",
        content:
          "z-50 bg-white ring-brand-gray-300 dark:bg-brand-gray-950 dark:ring-brand-gray-700",
        body: "max-h-[72vh] overflow-auto select-text",
      },
      compoundVariants: [
        {
          fullscreen: false,
          class: {
            content: "max-w-5xl",
          },
        },
      ],
    },
  },
});
