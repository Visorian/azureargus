const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/
const REGIONAL_INDICATOR_OFFSET = 127_397

export function normalizeCountryCode(value: string | null | undefined) {
  const countryCode = value?.trim().toUpperCase()
  return countryCode && COUNTRY_CODE_PATTERN.test(countryCode) ? countryCode : null
}

export function countryCodeToFlag(value: string | null | undefined) {
  const countryCode = normalizeCountryCode(value)
  if (!countryCode) {
    return ''
  }

  return Array.from(countryCode, (character) =>
    String.fromCodePoint((character.codePointAt(0) ?? 0) + REGIONAL_INDICATOR_OFFSET),
  ).join('')
}

export function countryCodeToName(
  value: string | null | undefined,
  locales?: Intl.LocalesArgument,
) {
  const countryCode = normalizeCountryCode(value)
  if (!countryCode) {
    return ''
  }

  try {
    return new Intl.DisplayNames(locales, { type: 'region' }).of(countryCode) ?? countryCode
  } catch {
    return countryCode
  }
}
