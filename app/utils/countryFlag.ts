const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u
const REGIONAL_INDICATOR_OFFSET = 127_397

export function normalizeCountryCode(value: string | null | undefined): string | null {
  const countryCode = value?.trim().toUpperCase()
  return countryCode !== undefined && COUNTRY_CODE_PATTERN.test(countryCode) ? countryCode : null
}

export function countryCodeToFlag(value: string | null | undefined): string {
  const countryCode = normalizeCountryCode(value)
  if (countryCode === null) {
    return ''
  }

  return Array.from(countryCode, (character) =>
    String.fromCodePoint((character.codePointAt(0) ?? 0) + REGIONAL_INDICATOR_OFFSET),
  ).join('')
}

export function countryCodeToName(
  value: string | null | undefined,
  locales?: Intl.LocalesArgument,
): string {
  const countryCode = normalizeCountryCode(value)
  if (countryCode === null) {
    return ''
  }

  try {
    return new Intl.DisplayNames(locales, { type: 'region' }).of(countryCode) ?? countryCode
  } catch {
    return countryCode
  }
}
