/**
 * Revenue and profit per day as the profit sheet (/pnl) shows them: the figures kept per day (`pnl_days`) with the costs
 * typed on the sheet (`daily_costs`) on top. The cumulative reconciliation prefers these to the figures it just read from
 * the POS, so its chart and the sheet always agree; a day the sheet has not kept yet stays with the POS figure.
 */
import type { SheetCell, SheetChannel, SheetLine, SheetMarket } from "../costs/daily-sheet";
import type { StoredPnlDay } from "./repository";
import { computePnl, PNL_ROWS } from "./sheet";

/** Revenue and profit (in the shop's currency) of every day the sheet holds figures for. */
export function sheetDailyFigures(market: SheetMarket, dates: string[], stored: StoredPnlDay[], cells: SheetCell[]) {
  const kept = new Map(stored.map((day) => [day.date, day.values]));
  const days = dates.filter((date) => kept.has(date));
  const amounts = new Map(cells.map((cell) => [`${cell.date}|${cell.channel}|${cell.line}`, cell.amount]));
  const cell = (date: string, line: SheetLine, channel: SheetChannel) => {
    const amount = amounts.get(`${date}|${channel}|${line}`);
    return amount === undefined ? undefined : { amount, typed: false };
  };
  const computed = computePnl(PNL_ROWS[market], days, kept, cell);
  const revenue = computed.byDay.get("1") ?? [];
  const profit = computed.byDay.get("10") ?? [];
  return new Map(days.map((date, index) => [date, { revenue: revenue[index] ?? 0, profit: profit[index] ?? 0 }]));
}
