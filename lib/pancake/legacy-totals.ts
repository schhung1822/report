/**
 * Philippines: the figures of a shop that no longer sells. The accountant's "Tổng cộng dồn" (section IV of the report) still includes
 * it, while the app only reads the shops that are live on Pancake, so the accountant types its totals in (cost page, tab "Shop Phil
 * cũ") and they are added to every point of the whole-history series. Pure: no database here.
 */
import type { CumulativePoint } from "./refund";

export type LegacyTotals = {
  /** Name of the old shop, only to recognise it. */
  label: string | null;
  /** Added to the amount the "Tổng cộng dồn" card shows (pesos). */
  revenue: number;
  /** Added to the successful revenue the refund rate is divided by (pesos). */
  confirmed: number;
  /** Added to the refunded value the refund rate is made of (pesos). */
  returned: number;
  /** Added to the orders of the "refunded/orders" line. */
  orders: number;
  /** Added to the refunded orders of that line. */
  refunded: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type Validation = { ok: true; value: Omit<LegacyTotals, "updatedBy" | "updatedAt"> } | { ok: false; error: string };

const MAX_AMOUNT = 1_000_000_000_000;
const MAX_COUNT = 100_000_000;
const round2 = (value: number) => Math.round(value * 100) / 100;

const MONEY_FIELDS = [
  { key: "revenue", label: "Doanh số cộng vào thẻ" },
  { key: "confirmed", label: "Doanh số thành công" },
  { key: "returned", label: "Giá trị đơn hoàn" },
] as const;
const COUNT_FIELDS = [
  { key: "orders", label: "Số đơn" },
  { key: "refunded", label: "Số đơn hoàn" },
] as const;

/** Validates what the browser sent (the same rules are a CHECK in MySQL). */
export function validateLegacyTotals(raw: unknown): Validation {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const input = raw as Record<string, unknown>;
  const value = { label: null, note: null, revenue: 0, confirmed: 0, returned: 0, orders: 0, refunded: 0 } as Omit<LegacyTotals, "updatedBy" | "updatedAt">;
  for (const { key, label } of MONEY_FIELDS) {
    const amount = input[key] === "" || input[key] == null ? 0 : Number(input[key]);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) return { ok: false, error: `“${label}” phải là số từ 0 trở lên.` };
    value[key] = round2(amount);
  }
  for (const { key, label } of COUNT_FIELDS) {
    const count = input[key] === "" || input[key] == null ? 0 : Number(input[key]);
    if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) return { ok: false, error: `“${label}” phải là số nguyên từ 0 trở lên.` };
    value[key] = count;
  }
  if (value.returned > value.confirmed) return { ok: false, error: "Giá trị đơn hoàn không thể lớn hơn doanh số thành công." };
  if (value.refunded > value.orders) return { ok: false, error: "Số đơn hoàn không thể lớn hơn số đơn." };
  for (const key of ["label", "note"] as const) {
    const text = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    if (text.length > 190) return { ok: false, error: "Tên hoặc ghi chú quá dài (tối đa 190 ký tự)." };
    value[key] = text || null;
  }
  return { ok: true, value };
}

/** True when the shop adds nothing (every figure is 0). */
export const isEmptyLegacy = (totals: Pick<LegacyTotals, "revenue" | "confirmed" | "returned" | "orders" | "refunded">) =>
  totals.revenue === 0 && totals.confirmed === 0 && totals.returned === 0 && totals.orders === 0 && totals.refunded === 0;

/** The whole-history series with the old shop's totals added to every point (they are totals up to the report, so the same on each day). */
export function addLegacyToSeries(series: CumulativePoint[], legacy: LegacyTotals): CumulativePoint[] {
  return series.map((point) => ({
    ...point,
    revenue: round2(point.revenue + legacy.revenue),
    confirmed: round2(point.confirmed + legacy.confirmed),
    returned: round2(point.returned + legacy.returned),
    orders: point.orders + legacy.orders,
    refunded: point.refunded + legacy.refunded,
  }));
}
