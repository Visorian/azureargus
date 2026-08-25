export type LogTimeFormat = "12-hour" | "24-hour";
export type LogHourCycle = "h12" | "h23";
export type LogTimeZoneMode = "local" | "utc";

export const LOG_TIME_FORMAT_STORAGE_KEY = "azure-argus:log-time-format";
export const LOG_TIME_ZONE_STORAGE_KEY = "azure-argus:log-time-zone";

function isLogTimeFormat(value: string | null): value is LogTimeFormat {
  return value === "12-hour" || value === "24-hour";
}

function isLogTimeZoneMode(value: string | null): value is LogTimeZoneMode {
  return value === "local" || value === "utc";
}

export function useLogTimeFormat() {
  const format = useState<LogTimeFormat>("log-time-format", () => "24-hour");
  const timeZoneMode = useState<LogTimeZoneMode>("log-time-zone", () => "utc");
  const browserTimeZone = useState("log-browser-time-zone", () => "UTC");
  const lastError = useState<string | null>("log-time-format-error", () => null);
  let initialized = false;

  onMounted(() => {
    try {
      browserTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const storedFormat = window.localStorage.getItem(LOG_TIME_FORMAT_STORAGE_KEY);
      const storedTimeZone = window.localStorage.getItem(LOG_TIME_ZONE_STORAGE_KEY);
      format.value = isLogTimeFormat(storedFormat) ? storedFormat : "24-hour";
      timeZoneMode.value = isLogTimeZoneMode(storedTimeZone) ? storedTimeZone : "utc";
      lastError.value = null;
    } catch {
      lastError.value = "Display preferences could not be read from browser storage.";
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
        lastError.value = "Display preferences could not be saved in browser storage.";
      }
    },
    { flush: "sync" },
  );

  watch(
    timeZoneMode,
    (value) => {
      if (!initialized) return;

      try {
        window.localStorage.setItem(LOG_TIME_ZONE_STORAGE_KEY, value);
        lastError.value = null;
      } catch {
        lastError.value = "Display preferences could not be saved in browser storage.";
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
  const useLocalTime = computed({
    get: () => timeZoneMode.value === "local",
    set: (enabled: boolean) => {
      timeZoneMode.value = enabled ? "local" : "utc";
    },
  });
  const timeZone = computed(() => (useLocalTime.value ? browserTimeZone.value : "UTC"));

  function formatTimestamp(timestamp: string) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }

    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: date.getMilliseconds() === 0 ? undefined : 3,
      hourCycle: hourCycle.value,
      timeZone: timeZone.value,
    }).format(date);
  }

  return {
    browserTimeZone,
    format,
    formatTimestamp,
    hourCycle,
    lastError,
    timeZone,
    timeZoneMode,
    use12Hour,
    useLocalTime,
  };
}
