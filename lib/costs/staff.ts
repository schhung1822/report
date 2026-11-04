/**
 * Per-staff salary / fixed cost as a "current value from a date" - the way people think about it ("from 1 Nov Linh earns
 * 8,000,000 a month"). Stored as ordinary monthly cost entries: changing a value closes the previous entry the day
 * before and opens a new one, so past reports keep the salary that applied at the time.
 */
import { normalizeText } from "../workbook";
import { addDays, isValidIsoDate } from "../pancake/dates";
import { MAX_AMOUNT, parseWorkDays } from "./validate";
import type { CostEntry, CostEntryInput, CostType } from "./types";

export const STAFF_COST_TYPES = ["salary_sale_cskh", "bonus", "fixed_cost"] as const satisfies readonly CostType[];
export type StaffCostType = (typeof STAFF_COST_TYPES)[number];

export const STAFF_COST_LABELS: Record<StaffCostType, string> = {
  salary_sale_cskh: "Lương cứng",
  bonus: "Thưởng",
  fixed_cost: "Định phí",
};

/** Pay: costs `amount / số công chuẩn` for each day the staff member worked. The fixed cost is spread over every day. */
export function isPerWorkDay(costType: StaffCostType) {
  return costType !== "fixed_cost";
}

export type StaffCostItem = {
  staffName: string;
  costType: StaffCostType;
  amount: number;
  /** Standard working days of the month, for pay (salary, bonus); null for the fixed cost. */
  workDays: number | null;
};

export type StaffCostPlan = {
  /** Entries to end the day before the new value starts. */
  close: { id: number; validTo: string }[];
  /** An entry that already starts on that day: change its amount (and working days) instead of adding a second one. */
  update: { id: number; amount: number; workDays: number | null } | null;
  /** An entry that already starts on that day and the new value is 0: drop it. */
  remove: number | null;
  /** The new monthly entry. */
  insert: CostEntryInput | null;
};

export class StaffCostConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffCostConflict";
  }
}

export function isStaffCostType(value: unknown): value is StaffCostType {
  return typeof value === "string" && (STAFF_COST_TYPES as readonly string[]).includes(value);
}

/** Entries of one staff member and cost type, matched on the normalized name (accents and case ignored). */
export function staffEntries(entries: CostEntry[], staffName: string, costType: CostType) {
  const wanted = normalizeText(staffName);
  return entries.filter((entry) => entry.scope === "staff" && entry.costType === costType && normalizeText(entry.staffName) === wanted);
}

/** Entries of that staff member and type that charge on `date`. */
export function activeOn(entries: CostEntry[], date: string) {
  return entries.filter((entry) => entry.validFrom <= date && (entry.validTo === null || entry.validTo >= date));
}

/**
 * Plans how to make `item.amount` the monthly value from `validFrom`. Throws StaffCostConflict instead of guessing
 * when the existing data is not a simple monthly history (several parallel entries, daily entries, entries starting
 * later) - those must be edited by hand on the "Chi phí cố định" page.
 */
export function planStaffCost(existing: CostEntry[], shopId: number, item: StaffCostItem, validFrom: string): StaffCostPlan {
  const related = staffEntries(existing, item.staffName, item.costType);
  const who = `${item.staffName} (${STAFF_COST_LABELS[item.costType]})`;

  const later = related.find((entry) => entry.validFrom > validFrom);
  if (later) throw new StaffCostConflict(`${who} đã có khoản bắt đầu từ ${later.validFrom}, sau ngày áp dụng. Hãy sửa ở trang Chi phí cố định.`);

  const sameDay = related.filter((entry) => entry.validFrom === validFrom);
  const replaceable = sameDay.find((entry) => entry.period === "monthly" && entry.validTo === null);
  if (sameDay.length > (replaceable ? 1 : 0)) {
    throw new StaffCostConflict(`${who} đã có khoản khác bắt đầu đúng ngày ${validFrom}. Hãy sửa ở trang Chi phí cố định.`);
  }

  const active = activeOn(
    related.filter((entry) => entry.validFrom < validFrom),
    validFrom,
  );
  if (active.length > 1 || active.some((entry) => entry.period !== "monthly")) {
    throw new StaffCostConflict(`${who} có nhiều khoản hoặc khoản không tính theo tháng. Hãy sửa ở trang Chi phí cố định.`);
  }

  const close = active.map((entry) => ({ id: entry.id, validTo: addDays(validFrom, -1) }));
  if (replaceable) {
    return item.amount > 0
      ? { close, update: { id: replaceable.id, amount: item.amount, workDays: item.workDays }, remove: null, insert: null }
      : { close, update: null, remove: replaceable.id, insert: null };
  }
  const insert: CostEntryInput | null =
    item.amount > 0
      ? {
          shopId,
          scope: "staff",
          channel: null,
          staffName: item.staffName,
          costType: item.costType,
          label: STAFF_COST_LABELS[item.costType],
          amount: item.amount,
          period: "monthly",
          validFrom,
          validTo: null,
          note: null,
          workDays: item.workDays,
        }
      : null;
  return { close, update: null, remove: null, insert };
}

/** Applies a plan to an in-memory list (so several items of one request see each other's changes). */
export function applyPlanToList(entries: CostEntry[], plan: StaffCostPlan, newId: number | null): CostEntry[] {
  let next = entries.map((entry) => {
    const closing = plan.close.find((item) => item.id === entry.id);
    if (closing) return { ...entry, validTo: closing.validTo };
    if (plan.update?.id === entry.id) return { ...entry, amount: plan.update.amount, workDays: plan.update.workDays };
    return entry;
  });
  if (plan.remove !== null) next = next.filter((entry) => entry.id !== plan.remove);
  if (plan.insert && newId !== null) next.push({ ...plan.insert, id: newId, createdBy: null, updatedAt: null });
  return next;
}

type Validation = { ok: true; shopId: number; validFrom: string; items: StaffCostItem[] } | { ok: false; error: string };

export const MAX_STAFF_ITEMS = 200;

export function validateStaffCostRequest(raw: unknown): Validation {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const input = raw as Record<string, unknown>;

  const shopId = Number(input.shopId);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return { ok: false, error: "Mã shop không hợp lệ." };
  if (!isValidIsoDate(input.validFrom)) return { ok: false, error: "Ngày áp dụng không hợp lệ." };
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > MAX_STAFF_ITEMS) {
    return { ok: false, error: `Cần từ 1 đến ${MAX_STAFF_ITEMS} khoản để lưu.` };
  }

  const seen = new Set<string>();
  const items: StaffCostItem[] = [];
  for (const entry of input.items) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const staffName = typeof item.staffName === "string" ? item.staffName.trim() : "";
    if (!staffName || staffName.length > 120) return { ok: false, error: "Tên nhân sự không hợp lệ (1–120 ký tự)." };
    if (!isStaffCostType(item.costType)) return { ok: false, error: "Loại chi phí nhân sự không hợp lệ." };
    const amount = typeof item.amount === "number" ? item.amount : Number(item.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) return { ok: false, error: `Số tiền của ${staffName} không hợp lệ.` };
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return { ok: false, error: `Số tiền của ${staffName} chỉ có tối đa 2 chữ số thập phân.` };

    const key = `${normalizeText(staffName)}|${item.costType}`;
    if (seen.has(key)) return { ok: false, error: `${staffName} bị trùng trong danh sách lưu.` };
    seen.add(key);

    // Pay is split over the standard working days, so it needs them; the fixed cost never has any.
    let workDays: number | null = null;
    if (isPerWorkDay(item.costType)) {
      const parsed = parseWorkDays(item.workDays);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      if (parsed.value === null && amount > 0) return { ok: false, error: `Hãy nhập số công chuẩn để tính lương/thưởng của ${staffName}.` };
      workDays = parsed.value;
    }
    items.push({ staffName, costType: item.costType, amount: Math.round(amount * 100) / 100, workDays });
  }
  return { ok: true, shopId, validFrom: input.validFrom, items };
}
