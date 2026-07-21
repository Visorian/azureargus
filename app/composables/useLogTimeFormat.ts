export type LogTimeFormat = "12-hour" | "24-hour";
export type LogHourCycle = "h12" | "h23";

export const LOG_TIME_FORMAT_STORAGE_KEY = "azure-argus:log-time-format";

function isLogTimeFormat(value: string | null): value is LogTimeFormat {
  return value === "12-hour" || value === "24-hour";
}

export function useLogTimeFormat() {
  const format = useState<LogTimeFormat>("log-time-format", () => "24-hour");
  const lastError = useState<string | null>("log-time-format-error", () => null);
  let initialized = false;

  onMounted(() => {
    try {
      const storedFormat = window.localStorage.getItem(LOG_TIME_FORMAT_STORAGE_KEY);
      format.value = isLogTimeFormat(storedFormat) ? storedFormat : "24-hour";
      lastError.value = null;
    } catch {
      lastError.value = "Time format preference could not be read from browser storage.";
    } finally {
      initialized = true;
    }
  });

  watch(
    format,
    (value) => {
      if (!initialized) return;

      try {
        window.localStorage.setItem(LOG_TIME_FORMAT_STORAGE_KEY, value);
        lastError.value = null;
      } catch {
        lastError.value = "Time format preference could not be saved in browser storage.";
      }
    },
    { flush: "sync" },
  );

  const use12Hour = computed({
    get: () => format.value === "12-hour",
    set: (enabled: boolean) => {
      format.value = enabled ? "12-hour" : "24-hour";
    },
  });
  const hourCycle = computed<LogHourCycle>(() => (use12Hour.value ? "h12" : "h23"));

  return {
    format,
    hourCycle,
    lastError,
    use12Hour,
  };
}
