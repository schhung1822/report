/** Number and date formatting shared by the chart kit. Amounts and percents are formatted with Intl, in the given locale. */

type NumberOptions = Intl.NumberFormatOptions & { locale?: string }

function format(value: number, { locale = "vi-VN", ...options }: NumberOptions) {
  const safe = Number.isFinite(value) ? value : 0
  try {
    return new Intl.NumberFormat(locale, options).format(safe)
  } catch {
    // an unknown currency code or locale must never break a report
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: options.maximumFractionDigits ?? 2 }).format(safe)
  }
}

/** A full amount in a currency ("1.234.567 ₫", "₱1,234.50"). Extra Intl options (signDisplay, fraction digits) pass through. */
export function formatCurrency(value: number, { currency = "VND", ...options }: NumberOptions & { currency?: string } = {}) {
  return format(value, { style: "currency", currency, ...options })
}

/** A short amount for axes and tags ("1,2 Tr ₫", "$1.2M"). */
export function formatCompactCurrency(value: number, { currency = "VND", ...options }: NumberOptions & { currency?: string } = {}) {
  return format(value, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1, ...options })
}

export function formatNumber(value: number, options: NumberOptions = {}) {
  return format(value, options)
}

/** `value` is already in percent: 31.1 -> "31,1%". */
export function formatPercent(value: number, options: NumberOptions = {}) {
  return format(value / 100, { style: "percent", ...options })
}

/**
 * A date given as ISO ("2026-05-06", or "2026-05" style first-of-month) in the given Intl options. The date is read as
 * UTC and printed as UTC, so the day never shifts with the viewer's time zone.
 */
export function formatDay(date: string, options: Intl.DateTimeFormatOptions, locale = "vi-VN") {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date)
  if (Number.isNaN(parsed.getTime())) return date
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(parsed)
  } catch {
    return date
  }
}
