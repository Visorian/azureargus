export function normalizeCountryCode(value: string | null | undefined) {
  const countryCode = value?.trim().toUpperCase();
  return countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
}

export function countryCodeToFlag(value: string | null | undefined) {
  const countryCode = normalizeCountryCode(value);
  if (!countryCode) {
    return "";
  }

  return Array.from(countryCode, (character) =>
    String.fromCodePoint(character.charCodeAt(0) + 127_397),
  ).join("");
}

export function countryCodeToName(
  value: string | null | undefined,
  locales?: Intl.LocalesArgument,
) {
  const countryCode = normalizeCountryCode(value);
  if (!countryCode) {
    return "";
  }

  try {
    return new Intl.DisplayNames(locales, { type: "region" }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}
