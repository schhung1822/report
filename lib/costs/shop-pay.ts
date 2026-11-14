/**
 * Vietnam shop: the monthly totals of the whole shop as a "current value from a date", like the per-staff pay (staff.ts):
 * the two salary totals (Sale/CSKH and the other departments), shared out by revenue (lib/pancake/ph-payroll.ts), and the fixed
 * cost and the other fixed cost, divided evenly over the days of the month (expand.ts). Stored as ordinary monthly shop-scope
 * cost entries: changing a value closes the previous entry the day before and opens a new one, so past reports keep the amount
 * that applied at the time.
 */
import { addDays, isValidIsoDate } from "../pancake/dates";
import { MAX_AMOUNT } from "./validate";
import type { CostEntry, CostEntryInput } from "./types";

export const SHOP_PAY_TYPES = ["salary_sale_cskh", "salary_other", "fixed_cost", "other_cost"] as const;
export type ShopPayType = (typeof SHOP_PAY_TYPES)[number];

export const SHOP_PAY_LABELS: Record<ShopPayType, string> = {
  salary_sale_cskh: "Lương Sale / CSKH",
  salary_other: "Lương các bộ phận khác",
  fixed_cost: "Định phí",
  other_cost: "Định phí khác",
};

export type ShopPayItem = { costType: ShopPayType; amount: number };

export type ShopPayPlan = {
  close: { id: number; validTo: string }[];
  update: { id: number; amount: number } | null;
  remove: number | null;
  insert: CostEntryInput | null;
};

export class ShopPayConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopPayConflict";
  }
}

export function isShopPayType(value: unknown): value is ShopPayType {
  return typeof value === "string" && (SHOP_PAY_TYPES as readonly string[]).includes(value);
}

/** The shop-scope monthly entries of one type. */
export function shopPayEntries(entries: CostEntry[], costType: ShopPayType) {
  return entries.filter((entry) => entry.scope === "shop" && entry.costType === costType && entry.period === "monthly");
}

/** Plans how to make `item.amount` the monthly total from `validFrom`; throws instead of guessing when the history is not a simple one. */
export function planShopPay(existing: CostEntry[], shopId: number, item: ShopPayItem, validFrom: string): ShopPayPlan {
  const related = shopPayEntries(existing, item.costType);
  const who = SHOP_PAY_LABELS[item.costType];
  const hint = "Hãy sửa ở tab “Chi phí cố định hằng tháng”.";

  const later = related.find((entry) => entry.validFrom > validFrom);
  if (later) throw new ShopPayConflict(`${who} đã có khoản bắt đầu từ ${later.validFrom}, sau ngày áp dụng. ${hint}`);

  const sameDay = related.filter((entry) => entry.validFrom === validFrom);
  const replaceable = sameDay.find((entry) => entry.validTo === null);
  if (sameDay.length > (replaceable ? 1 : 0)) throw new ShopPayConflict(`${who} đã có khoản khác bắt đầu đúng ngày ${validFrom}. ${hint}`);

  const active = related.filter((entry) => entry.validFrom < validFrom && (entry.validTo === null || entry.validTo >= validFrom));
  if (active.length > 1) throw new ShopPayConflict(`${who} có nhiều khoản cùng lúc. ${hint}`);

  const close = active.map((entry) => ({ id: entry.id, validTo: addDays(validFrom, -1) }));
  if (replaceable) {
    return item.amount > 0
      ? { close, update: { id: replaceable.id, amount: item.amount }, remove: null, insert: null }
      : { close, update: null, remove: replaceable.id, insert: null };
  }
  const insert: CostEntryInput | null =
    item.amount > 0
      ? {
          shopId,
          scope: "shop",
          channel: null,
          staffName: null,
          costType: item.costType,
          label: who,
          amount: item.amount,
          period: "monthly",
          validFrom,
          validTo: null,
          note: null,
          workDays: null,
        }
      : null;
  return { close, update: null, remove: null, insert };
}

export function applyShopPlanToList(entries: CostEntry[], plan: ShopPayPlan, newId: number | null): CostEntry[] {
  let next = entries.map((entry) => {
    const closing = plan.close.find((item) => item.id === entry.id);
    if (closing) return { ...entry, validTo: closing.validTo };
    if (plan.update?.id === entry.id) return { ...entry, amount: plan.update.amount };
    return entry;
  });
  if (plan.remove !== null) next = next.filter((entry) => entry.id !== plan.remove);
  if (plan.insert && newId !== null) next.push({ ...plan.insert, id: newId, createdBy: null, updatedAt: null });
  return next;
}

type Validation = { ok: true; shopId: number; validFrom: string; items: ShopPayItem[] } | { ok: false; error: string };

export function validateShopPayRequest(raw: unknown): Validation {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const input = raw as Record<string, unknown>;
  const shopId = Number(input.shopId);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return { ok: false, error: "Mã shop không hợp lệ." };
  if (!isValidIsoDate(input.validFrom)) return { ok: false, error: "Ngày áp dụng không hợp lệ." };
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > SHOP_PAY_TYPES.length) {
    return { ok: false, error: "Cần nhập ít nhất một khoản tổng theo tháng." };
  }
  const seen = new Set<string>();
  const items: ShopPayItem[] = [];
  for (const entry of input.items) {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (!isShopPayType(item.costType)) return { ok: false, error: "Loại chi phí không hợp lệ." };
    if (seen.has(item.costType)) return { ok: false, error: "Một khoản bị trùng trong danh sách lưu." };
    seen.add(item.costType);
    const amount = typeof item.amount === "number" ? item.amount : Number(item.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) return { ok: false, error: `Số tiền “${SHOP_PAY_LABELS[item.costType]}” không hợp lệ.` };
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return { ok: false, error: "Số tiền chỉ có tối đa 2 chữ số thập phân." };
    items.push({ costType: item.costType, amount: Math.round(amount * 100) / 100 });
  }
  return { ok: true, shopId, validFrom: input.validFrom, items };
}
