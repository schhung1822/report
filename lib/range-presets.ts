/** Date helpers shared by the report forms (browser side, local calendar dates). */

/** Local calendar date as "YYYY-MM-DD", `offsetDays` away from today. */
export function localDate(offsetDays = 0, base = new Date()) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const RANGE_PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "Hôm qua", range: () => ({ from: localDate(-1), to: localDate(-1) }) },
  { label: "7 ngày qua", range: () => ({ from: localDate(-7), to: localDate(-1) }) },
  { label: "Tháng này", range: () => ({ from: `${localDate().slice(0, 7)}-01`, to: localDate() }) },
  {
    label: "Tháng trước",
    range: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: localDate(0, first), to: localDate(0, last) };
    },
  },
];

/** Number of days from `from` to `to`, both included (0 when a date is missing or malformed). */
export function dayCount(from: string, to: string) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) + 1 : 0;
}
