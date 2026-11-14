/**
 * Philippines shop: costs that are a fixed amount of pesos per PRODUCT (item sold), so nobody has to type them day by day.
 * A day's amount = items sold that day (not canceled orders; see ph-cogs.ts for how items are counted) x the rate in force that day.
 * A day the accountant typed a figure for (daily cost sheet) keeps that figure instead.
 *
 * The rates are set on the page "Chi phí cố định" (tab "Đơn giá theo sản phẩm") and kept as a history: a rate counts from its
 * effective date, so changing it leaves the earlier days at the old amount. Until one is saved the defaults below apply.
 * (The "PerOrder" names and the order_cost_rates table date from when these were thought to be per order; they are per product.)
 */
import { isValidIsoDate } from "./dates";

export type PerOrderRates = {
  /** Chi phí dịch vụ mua ngoài. */
  outsourced: number;
  /** Giao hàng từ PED đến Phi. */
  shippingPedPh: number;
  /** Giao hàng bên Phi. */
  shippingPh: number;
  /** Chi phí khác. */
  other: number;
  /** Thuế, phí và lệ phí. */
  tax: number;
};

/** A set of rates and the day it starts to apply. */
export type PerOrderRatesEntry = PerOrderRates & { effectiveDate: string; updatedBy?: string | null; updatedAt?: string | null };

export const PER_ORDER_FIELDS: { key: keyof PerOrderRates; label: string }[] = [
  { key: "outsourced", label: "Dịch vụ mua ngoài" },
  { key: "shippingPedPh", label: "Giao hàng từ PED đến Phi" },
  { key: "shippingPh", label: "Giao hàng bên Phi" },
  { key: "other", label: "Chi phí khác" },
  { key: "tax", label: "Thuế, phí và lệ phí" },
];

/** Used for every day until a rate is saved. */
export const DEFAULT_PER_ORDER_RATES: PerOrderRates = { outsourced: 74, shippingPedPh: 577, shippingPh: 84, other: 10, tax: 15 };

export const MAX_PER_ORDER_RATE = 1e7;

const round2 = (value: number) => Math.round(value * 100) / 100;

const ratesOf = (entry: PerOrderRates): PerOrderRates => ({
  outsourced: entry.outsourced,
  shippingPedPh: entry.shippingPedPh,
  shippingPh: entry.shippingPh,
  other: entry.other,
  tax: entry.tax,
});

/** The rates in force on `date`: the set with the greatest effective date not after it, else the defaults. */
export function perOrderRatesOn(history: PerOrderRatesEntry[], date: string): PerOrderRates {
  let best: PerOrderRatesEntry | null = null;
  for (const entry of history) {
    if (entry.effectiveDate > date) continue;
    if (!best || entry.effectiveDate > best.effectiveDate) best = entry;
  }
  return best ? ratesOf(best) : DEFAULT_PER_ORDER_RATES;
}

/** Both shipping legs together: the "Chi phí giao hàng bán" of one product. */
export const shippingPerOrder = (rates: PerOrderRates) => round2(rates.shippingPedPh + rates.shippingPh);

/** What `items` products cost in pesos, line by line. */
export function perOrderCosts(items: number, rates: PerOrderRates = DEFAULT_PER_ORDER_RATES) {
  const count = Math.max(0, items);
  return {
    outsourced: round2(count * rates.outsourced),
    shippingPedPh: round2(count * rates.shippingPedPh),
    shippingPh: round2(count * rates.shippingPh),
    other: round2(count * rates.other),
    tax: round2(count * rates.tax),
  };
}

type Validation = { ok: true; value: PerOrderRatesEntry } | { ok: false; error: string };

/** Validates one set of rates sent by the browser (the same rules are CHECKs in MySQL). */
export function validatePerOrderRates(raw: unknown): Validation {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const input = raw as Record<string, unknown>;
  if (!isValidIsoDate(input.effectiveDate)) return { ok: false, error: "Ngày hiệu lực không hợp lệ." };

  const value = { effectiveDate: input.effectiveDate } as PerOrderRatesEntry;
  for (const { key, label } of PER_ORDER_FIELDS) {
    const amount = typeof input[key] === "number" ? (input[key] as number) : Number(input[key]);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_PER_ORDER_RATE) return { ok: false, error: `“${label}” phải là số từ 0 trở lên.` };
    value[key] = round2(amount);
  }
  return { ok: true, value };
}
