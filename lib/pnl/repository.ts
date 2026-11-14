import { phShopGroup } from "@/lib/pancake/ph-shops";
import { CostDbError, withDb, type Db } from "../costs/db";
import type { PnlDayValues } from "./sheet";

const TABLE_MISSING = "Chưa có bảng pnl_days (số liệu Bảng lợi nhuận). Hãy chạy file database/migrations/2026-11-pnl-days.sql trên database này.";

export type StoredPnlDay = { date: string; values: PnlDayValues; fetchedAt: string };

/**
 * What the stored figures of a day mean. Raise it when the way a day is counted changes (v2: returns count against the day
 * the order was created; v6: PH per-day costs are per product, not per order; v7: VN return provision from the refund history; v8: PH sales are the COD, new orders are left out, PH inventory risk provision from the refund rate; v9: PH cost of goods and sales x (1 - month-to-date refund rate); v10: PH sales are the whole value of the orders, not the COD; v11: PH shops in PANCAKE_POS_COST_SHOP_IDS cost goods from the POS product cost). Days stored under another version are treated as never read, so the sheet reads them again.
 */
export const PNL_DATA_VERSION = 11;
const VERSION_KEY = "_v";

const isNoSuchTable = (error: unknown) => {
  const { code, errno } = (error ?? {}) as { code?: string; errno?: number };
  return code === "ER_NO_SUCH_TABLE" || errno === 1146;
};

function run<T>(db: Db | undefined, work: (conn: Db) => Promise<T>) {
  return withDb(db, async (conn) => {
    try {
      return await work(conn);
    } catch (error) {
      if (isNoSuchTable(error)) throw new CostDbError(TABLE_MISSING, 503);
      throw error;
    }
  });
}

/** MySQL's JSON type comes back parsed; MariaDB (JSON = LONGTEXT) returns a string. */
function parseValues(value: unknown): PnlDayValues {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const values: PnlDayValues = {};
  if (parsed && typeof parsed === "object") {
    for (const [key, amount] of Object.entries(parsed)) if (typeof amount === "number" && Number.isFinite(amount)) values[key] = amount;
  }
  return values;
}

const isCurrent = (values: PnlDayValues) => values[VERSION_KEY] === PNL_DATA_VERSION;

/** "2026-11-05 03:04:05.678" (UTC, as stored) -> ISO. */
const toIso = (value: unknown) => `${String(value).replace(" ", "T")}Z`;
/** ISO -> the DATETIME(3) text stored (UTC). */
const toDatetime = (iso: string) => iso.slice(0, 23).replace("T", " ");

export function listPnlDays(shopId: number, from: string, to: string, db?: Db) {
  return run(db, async (conn) => {
    const { rows } = await conn.query(
      "SELECT report_date, day_values, fetched_at FROM pnl_days WHERE shop_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date",
      [shopId, from, to],
    );
    return rows
      .map((row) => ({ date: String(row.report_date).slice(0, 10), values: parseValues(row.day_values), fetchedAt: toIso(row.fetched_at) }))
      .filter((day) => isCurrent(day.values))
      .map((day): StoredPnlDay => ({ ...day, values: Object.fromEntries(Object.entries(day.values).filter(([key]) => key !== VERSION_KEY)) }));
  });
}

/**
 * Forgets the kept figures of the days `from`..`to` (to the end when `to` is left out) because a cost they were worked out with
 * changed: the sheet and the cumulative reconciliation then read those days from the POS again. A deleted cost leaves no trace
 * to compare with, so this is done when the cost is saved or deleted. Never fails the caller: the worst case is a day that keeps
 * its old figures until the page's update button is pressed.
 */
export async function invalidatePnlDays(shopId: number, from: string, to?: string, db?: Db) {
  try {
    return await run(db, async (conn) => {
      // The Philippines shops share their costs and rates, so a change affects the days of every one of them.
      let removed = 0;
      for (const id of phShopGroup(shopId)) {
        const result = to
          ? await conn.query("DELETE FROM pnl_days WHERE shop_id = ? AND report_date BETWEEN ? AND ?", [id, from, to])
          : await conn.query("DELETE FROM pnl_days WHERE shop_id = ? AND report_date >= ?", [id, from]);
        removed += result.affectedRows;
      }
      return removed;
    });
  } catch {
    return 0;
  }
}

/** Stores (or replaces) the given days of a shop in one statement. */
export function savePnlDays(shopId: number, currency: string, days: StoredPnlDay[], fetchedBy: string | null, db?: Db) {
  if (!days.length) return Promise.resolve(0);
  return run(db, async (conn) => {
    await conn.query(
      `INSERT INTO pnl_days (shop_id, report_date, currency, day_values, fetched_at, fetched_by)
       VALUES ${days.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE currency = VALUES(currency), day_values = VALUES(day_values), fetched_at = VALUES(fetched_at), fetched_by = VALUES(fetched_by)`,
      days.flatMap((day) => [shopId, day.date, currency, JSON.stringify({ ...day.values, [VERSION_KEY]: PNL_DATA_VERSION }), toDatetime(day.fetchedAt), fetchedBy]),
    );
    return days.length;
  });
}
