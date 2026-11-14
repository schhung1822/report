/**
 * Philippines shop: cost of goods from the average cost of each kind of goods.
 *
 * The POS Philippines orders all carry one placeholder product ("NEXT", no category, cost 0); what was really sold is typed in the
 * order's printed note ("ASICS - GEL X - (1041A481-103) - size 38"). So the kind of goods of an order is read like this:
 *   - an order with the POS tag "Quần Áo" is clothes: "Đồ bộ" when its note says "set", else "Quần áo lẻ";
 *   - every other order is "Giày dép" (the shop mostly sells shoes).
 * Orders that mix shoes and clothes cannot be told apart yet: they follow the rule above and are counted as "mixed" so the report
 * can say how many there were.
 *
 * A day's cost of goods = sum over the kinds of (items sold of that kind x average cost of the kind in force that day). The
 * average costs are typed on the page "Chi phí cố định" (tab "Giá vốn theo danh mục") and kept as a dated history, like the
 * per-order rates. Pure: the orders come from the caller.
 */
import { normalizeText } from "../workbook";
import { isValidIsoDate } from "./dates";

export const COGS_CATEGORIES = [
  { key: "shoes", label: "Giày dép" },
  { key: "sets", label: "Đồ bộ" },
  { key: "clothes", label: "Quần áo lẻ" },
] as const;
export type CogsCategory = (typeof COGS_CATEGORIES)[number]["key"];

/** Average cost of goods (pesos per item) of each kind. */
export type CogsRates = Record<CogsCategory, number>;
export type CogsRatesEntry = CogsRates & { effectiveDate: string; updatedBy?: string | null; updatedAt?: string | null };

export const MAX_COGS_RATE = 1e8;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The average costs in force on `date`: the set with the greatest effective date not after it. Null when none applies yet. */
export function cogsRatesOn(history: CogsRatesEntry[], date: string): CogsRates | null {
  let best: CogsRatesEntry | null = null;
  for (const entry of history) {
    if (entry.effectiveDate > date) continue;
    if (!best || entry.effectiveDate > best.effectiveDate) best = entry;
  }
  return best ? { shoes: best.shoes, sets: best.sets, clothes: best.clothes } : null;
}

type Validation = { ok: true; value: CogsRatesEntry } | { ok: false; error: string };

/** Validates one set of average costs sent by the browser (the same rules are CHECKs in MySQL). */
export function validateCogsRates(raw: unknown): Validation {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const input = raw as Record<string, unknown>;
  if (!isValidIsoDate(input.effectiveDate)) return { ok: false, error: "Ngày hiệu lực không hợp lệ." };
  const value = { effectiveDate: input.effectiveDate } as CogsRatesEntry;
  for (const { key, label } of COGS_CATEGORIES) {
    const amount = typeof input[key] === "number" ? (input[key] as number) : Number(input[key]);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_COGS_RATE) return { ok: false, error: `Giá vốn “${label}” phải là số từ 0 trở lên.` };
    value[key] = round2(amount);
  }
  return { ok: true, value };
}

// ------------------------------------------------------------------------------------------------------------- orders

/** The fields of a POS order this module reads. */
export type CogsOrder = {
  inserted_at?: string | null;
  status?: number | string | null;
  tags?: ({ name?: string | null } | string)[] | null;
  note?: string | null;
  note_print?: string | null;
  total_quantity?: number | null;
  items?: { quantity?: number | null; returned_count?: number | null; return_quantity?: number | null }[] | null;
};

const NEW = 0;
const CANCELED = 6;
const REMOVED = 7;
/**
 * Returned: the goods came back, so their cost is not a cost of the sale. This is the statistics' own definition (verified on the
 * Philippines shop: only status 5 lands in its "returned" bucket; 4, "returning", still counts as sold, like the revenue does).
 * 15 (part returned) is read per item.
 */
const RETURNED = new Set([5, 19]);
const PART_RETURNED = 15;
const CLOTHING_TAG = "quan ao";
const NEWLINE = String.fromCharCode(10);

export type ClassifiedOrder = { category: CogsCategory; quantity: number; returned: number; mixed: boolean };

/** The kind, items sold (the larger of the POS quantity and the product lines of the printed note) and items returned of one order, or null for an order that was never a sale (new, canceled or removed). */
export function classifyOrder(order: CogsOrder): ClassifiedOrder | null {
  const status = Number(order.status);
  if (status === CANCELED || status === REMOVED) return null;
  // A new order (status 0) is not confirmed yet, so it is not a sale either (a missing status is not a new order).
  if (order.status != null && String(order.status).trim() === String(NEW)) return null;

  const fromItems = (order.items ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity ?? 0)), 0);
  const fromPos = fromItems > 0 ? fromItems : Math.max(0, Number(order.total_quantity ?? 0));
  // The POS quantity can be 1 for an order whose printed note lists several products (one per line): the note is then right.
  const noteLines = (order.note_print ?? "").split(NEWLINE).filter((line) => line.trim()).length;
  const quantity = Math.max(fromPos, noteLines);
  let returned = 0;
  if (RETURNED.has(status)) returned = quantity;
  else if (status === PART_RETURNED) {
    returned = Math.min(quantity, (order.items ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.returned_count ?? item.return_quantity ?? 0)), 0));
  }

  const clothing = (order.tags ?? []).some((tag) => normalizeText(typeof tag === "string" ? tag : (tag.name ?? "")) === CLOTHING_TAG);
  const text = `${order.note ?? ""}\n${order.note_print ?? ""}`;
  const isSet = /\bset\b/i.test(text);
  const category: CogsCategory = clothing ? (isSet ? "sets" : "clothes") : "shoes";
  // Shoe sizes in a clothing order, or a "set" in an untagged one: both kinds are probably in the same order.
  const mixed = clothing ? /size\s*(3[5-9]|4[0-8])(\.5)?\b/i.test(text) : isSet;
  return { category, quantity, returned, mixed };
}

export type DayQuantities = { estimated: CogsRates; actual: CogsRates };

const empty = (): CogsRates => ({ shoes: 0, sets: 0, clothes: 0 });

/** Items sold per day and kind. `estimated` counts every sale of the day; `actual` leaves out the items that came back. */
export function quantitiesByDay(orders: CogsOrder[], utcOffsetHours: number) {
  const days = new Map<string, DayQuantities>();
  let mixed = 0;
  let unreadable = 0;
  for (const order of orders) {
    const result = classifyOrder(order);
    if (!result) continue;
    const created = order.inserted_at ? Date.parse(order.inserted_at.endsWith("Z") ? order.inserted_at : `${order.inserted_at}Z`) : NaN;
    if (!Number.isFinite(created)) {
      unreadable += 1;
      continue;
    }
    const date = new Date(created + utcOffsetHours * 3_600_000).toISOString().slice(0, 10);
    const day = days.get(date) ?? { estimated: empty(), actual: empty() };
    day.estimated[result.category] += result.quantity;
    day.actual[result.category] += Math.max(0, result.quantity - result.returned);
    days.set(date, day);
    if (result.mixed) mixed += 1;
  }
  return { days, mixed, unreadable };
}

/** The cost of goods of a day in pesos: estimated (all sales) and actual (without the returned items). */
export function cogsOfDay(quantities: DayQuantities | undefined, rates: CogsRates) {
  const total = (items: CogsRates) => round2(COGS_CATEGORIES.reduce((sum, { key }) => sum + items[key] * rates[key], 0));
  const none = empty();
  return { estimated: total(quantities?.estimated ?? none), actual: total(quantities?.actual ?? none) };
}
