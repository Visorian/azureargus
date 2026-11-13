export const DEFAULT_CONSUMER_GROUP = '$Default'
export type EventHubLookbackMinutes = 1 | 3 | 5 | 10 | 15
export const EVENT_HUB_LOOKBACK_OPTIONS = [
  { label: 'Last 1 minute', value: 1 },
  { label: 'Last 3 minutes', value: 3 },
  { label: 'Last 5 minutes', value: 5 },
  { label: 'Last 10 minutes', value: 10 },
  { label: 'Last 15 minutes', value: 15 },
] satisfies { label: string; value: EventHubLookbackMinutes }[]
export const DEFAULT_LOOKBACK_MINUTES: EventHubLookbackMinutes = 15
export const DEFAULT_BUFFER_SIZE = 5_000
export const RAW_BUFFER_MULTIPLIER = 10
export const MAX_RAW_BUFFER_SIZE = 50_000

export function getRawLogBufferSize(visibleLimit: number): number {
  const boundedLimit = Number.isFinite(visibleLimit) ? Math.max(0, Math.floor(visibleLimit)) : 0
  return Math.min(Math.max(boundedLimit, boundedLimit * RAW_BUFFER_MULTIPLIER), MAX_RAW_BUFFER_SIZE)
}

export interface EventHubConnectionForm {
  connectionString: string
  consumerGroup: string
  eventHubName: string
  lookbackMinutes: EventHubLookbackMinutes
  bufferSize: number
}

export function isEventHubLookbackMinutes(value: number): value is EventHubLookbackMinutes {
  return value === 1 || value === 3 || value === 5 || value === 10 || value === 15
}

export function normalizeEventHubLookbackMinutes(value: number): EventHubLookbackMinutes {
  return isEventHubLookbackMinutes(value) ? value : DEFAULT_LOOKBACK_MINUTES
}

export function createInitialEventHubConnectionForm(
  defaultLookbackMinutes: number = DEFAULT_LOOKBACK_MINUTES,
): EventHubConnectionForm {
  return {
    connectionString: '',
    consumerGroup: DEFAULT_CONSUMER_GROUP,
    eventHubName: '',
    lookbackMinutes: normalizeEventHubLookbackMinutes(defaultLookbackMinutes),
    bufferSize: DEFAULT_BUFFER_SIZE,
  }
}

export function parseEventHubConnectionString(connectionString: string): Map<string, string> {
  const values = new Map<string, string>()

  for (const part of connectionString.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (key.length > 0 && value.length > 0) {
      values.set(key.toLowerCase(), value)
    }
  }

  return values
}

export function getEventHubName(form: EventHubConnectionForm): string {
  const values = parseEventHubConnectionString(form.connectionString)
  return values.get('entitypath') ?? form.eventHubName.trim()
}

export function getEventHubLookbackStart(lookbackMinutes: number, now = new Date()): Date {
  const boundedMinutes = Number.isFinite(lookbackMinutes) ? Math.max(0, lookbackMinutes) : 0
  return new Date(now.getTime() - boundedMinutes * 60_000)
}

export function validateEventHubConnectionForm(form: EventHubConnectionForm): string[] {
  return validateEventHubFields(form).map((error) => error.message)
}

export interface EventHubFieldError {
  name: keyof EventHubConnectionForm
  message: string
}

export function validateEventHubFields(
  form: EventHubConnectionForm,
  managed = false,
): EventHubFieldError[] {
  const errors: EventHubFieldError[] = []
  const values = parseEventHubConnectionString(form.connectionString)

  if (!managed) {
    if (form.connectionString.trim().length === 0) {
      errors.push({ name: 'connectionString', message: 'Connection string is required.' })
    } else {
      if (!values.has('endpoint')) {
        errors.push({
          name: 'connectionString',
          message: 'Connection string must include Endpoint.',
        })
      }
      if (!values.has('sharedaccesskeyname')) {
        errors.push({
          name: 'connectionString',
          message: 'Connection string must include SharedAccessKeyName.',
        })
      }
      if (!values.has('sharedaccesskey')) {
        errors.push({
          name: 'connectionString',
          message: 'Connection string must include SharedAccessKey.',
        })
      }
      if (!getEventHubName(form)) {
        errors.push({
          name: 'eventHubName',
          message: 'Event Hub name is required when EntityPath is not present.',
        })
      }
    }
  }

  errors.push(...validateReceiverFields(form))
  return errors
}

export function validateEventHubReceiverSettings(form: EventHubConnectionForm): string[] {
  return validateReceiverFields(form).map((error) => error.message)
}

function validateReceiverFields(form: EventHubConnectionForm) {
  const errors: EventHubFieldError[] = []

  if (form.consumerGroup.trim().length === 0) {
    errors.push({ name: 'consumerGroup', message: 'Consumer group is required.' })
  }

  if (!isEventHubLookbackMinutes(form.lookbackMinutes)) {
    errors.push({
      name: 'lookbackMinutes',
      message: 'Lookback window must be 1, 3, 5, 10, or 15 minutes.',
    })
  }

  if (!Number.isInteger(form.bufferSize) || form.bufferSize < 100) {
    errors.push({
      name: 'bufferSize',
      message: 'Visible row limit must be at least 100 log entries.',
    })
  }

  return errors
}
