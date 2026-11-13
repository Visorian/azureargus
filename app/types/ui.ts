export type UiTone = 'success' | 'error' | 'warning' | 'neutral' | 'primary'

export interface SegmentedControlItem<T extends string = string> {
  value: T
  label: string
  icon?: string
  disabled?: boolean
  description?: string
}

export interface DisplayField {
  label: string
  value: string
  mono?: boolean
}
