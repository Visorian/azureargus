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
      ],
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
