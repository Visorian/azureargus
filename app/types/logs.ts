export interface MobileQueryState {
  canRun: boolean
  hasRun: boolean
  dirty: boolean
  status: 'idle' | 'loading' | 'refreshing' | 'success' | 'error'
  pendingMessage: string
  rangeError: string | null
  error: string | null
}

export type LogQuickFilterKey =
  | 'category'
  | 'action'
  | 'protocol'
  | 'source'
  | 'sourcePort'
  | 'destination'
  | 'destinationPort'
