/**
 * House exchange rates ("1 PHP = ? VND") kept as a history. Reports use the LATEST rate that is already in effect
 * for every day they show, so changing the rate once updates every report built afterwards.
 */
import { isValidIsoDate } from "../pancake/dates";

/** The only pair the reports convert today. */
export const RATE_PAIR = { from: "PHP", to: "VND" } as const;

export const MAX_RATE = 1e9;

export type ExchangeRateInput = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  /** "YYYY-MM-DD": the rate is in effect from this day. */
  effectiveDate: string;
  note: string | null;
};

export type ExchangeRateEntry = ExchangeRateInput & {
  id: number;
  createdBy: string | null;
  updatedAt: string | null;
};

/**
 * The rate in force on `asOf`: the one with the greatest effective date that is not after `asOf`.
 * A rate dated in the future waits until its day. Returns null when no rate is in effect yet.
 */
export function latestRate<T extends Pick<ExchangeRateInput, "rate" | "effectiveDate">>(entries: T[], asOf: string): T | null {
  let best: T | null = null;
  for (const entry of entries) {
    if (entry.effectiveDate > asOf) continue;
    if (!best || entry.effectiveDate > best.effectiveDate) best = entry;
  }
  return best;
}

type Validation = { ok: true; value: ExchangeRateInput } | { ok: false; error: string };

/** Validates one rate sent by the browser (the same rules are CHECKs in MySQL). */
export function validateRateInput(raw: unknown): Validation {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const input = raw as Record<string, unknown>;

  const fromCurrency = typeof input.fromCurrency === "string" ? input.fromCurrency.trim().toUpperCase() : RATE_PAIR.from;
  const toCurrency = typeof input.toCurrency === "string" ? input.toCurrency.trim().toUpperCase() : RATE_PAIR.to;
  if (fromCurrency !== RATE_PAIR.from || toCurrency !== RATE_PAIR.to) {
    return { ok: false, error: `Hiện chỉ hỗ trợ tỷ giá ${RATE_PAIR.from} → ${RATE_PAIR.to}.` };
  }

  const rate = typeof input.rate === "number" ? input.rate : Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_RATE) return { ok: false, error: "Tỷ giá phải là số lớn hơn 0." };
  if (Math.abs(rate * 1e6 - Math.round(rate * 1e6)) > 1e-3) return { ok: false, error: "Tỷ giá chỉ được có tối đa 6 chữ số thập phân." };

  if (!isValidIsoDate(input.effectiveDate)) return { ok: false, error: "Ngày hiệu lực không hợp lệ." };

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string" || input.note.trim().length > 255) return { ok: false, error: "Ghi chú tối đa 255 ký tự." };
    note = input.note.trim() || null;
  }

  return { ok: true, value: { fromCurrency, toCurrency, rate: Math.round(rate * 1e6) / 1e6, effectiveDate: input.effectiveDate, note } };
}
