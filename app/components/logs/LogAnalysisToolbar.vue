<template>
  <div
    class="shrink-0 border-b border-brand-gray-300 px-4 py-3 dark:border-brand-gray-700"
    data-testid="log-analysis-toolbar"
  >
    <div class="flex flex-wrap items-center gap-2" data-testid="log-filter-row">
      <slot name="filters" />
    </div>
    <div
      v-if="$slots.query || $slots.summary"
      class="mt-3 flex flex-wrap items-end justify-between gap-3"
      data-testid="log-query-row"
    >
      <slot name="query" />
      <div
        v-if="$slots.summary"
        class="self-end py-2 text-xs text-brand-gray-600 dark:text-brand-gray-300"
      >
        <slot name="summary" />
      </div>
    </div>
  </div>
</template>
