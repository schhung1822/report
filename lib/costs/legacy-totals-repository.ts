import { costShopId } from "@/lib/pancake/ph-shops";
import type { LegacyTotals } from "../pancake/legacy-totals";
import { CostDbError, withDb, type Db } from "./db";

const TABLE_MISSING =
  "Chưa có bảng ph_legacy_totals (số cộng dồn của shop Phil cũ). Hãy chạy file database/migrations/2026-11-ph-legacy-totals.sql trên database này.";

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

const COLUMNS = "label, revenue, confirmed, returned, orders, refunded, note, updated_by, updated_at";

function toTotals(row: Record<string, unknown>): LegacyTotals {
  return {
    label: (row.label as string | null) ?? null,
    revenue: Number(row.revenue),
    confirmed: Number(row.confirmed),
    returned: Number(row.returned),
    orders: Number(row.orders),
    refunded: Number(row.refunded),
    note: (row.note as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

/** The old shop's totals of the Philippines shop group of `shopId`, or null when none were saved. */
export function getLegacyTotals(shopId: number, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => {
    const { rows } = await conn.query(`SELECT ${COLUMNS} FROM ph_legacy_totals WHERE shop_id = ?`, [shopId]);
    return rows[0] ? toTotals(rows[0]) : null;
  });
}

/**
 * The same for a report. A database that has no such table yet (the migration was not run) is not an error for a report: nothing is
 * added. Any other failure still fails the report, like the other costs do.
 */
export async function getLegacyTotalsForReport(shopId: number, db?: Db) {
  try {
    return await getLegacyTotals(shopId, db);
  } catch (error) {
    if (error instanceof CostDbError && error.message === TABLE_MISSING) return null;
    throw error;
  }
}

/** Saves the totals (one row per shop group, a new save replaces the old one). */
export function saveLegacyTotals(shopId: number, totals: Omit<LegacyTotals, "updatedBy" | "updatedAt">, updatedBy: string | null, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => {
    await conn.query(
      `INSERT INTO ph_legacy_totals (shop_id, label, revenue, confirmed, returned, orders, refunded, note, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), revenue = VALUES(revenue), confirmed = VALUES(confirmed), returned = VALUES(returned),
         orders = VALUES(orders), refunded = VALUES(refunded), note = VALUES(note), updated_by = VALUES(updated_by)`,
      [shopId, totals.label, totals.revenue, totals.confirmed, totals.returned, totals.orders, totals.refunded, totals.note, updatedBy],
    );
    const { rows } = await conn.query(`SELECT ${COLUMNS} FROM ph_legacy_totals WHERE shop_id = ?`, [shopId]);
    if (!rows[0]) throw new CostDbError("Không đọc lại được số vừa lưu.", 500);
    return toTotals(rows[0]);
  });
}

/** Returns false when nothing was saved. */
export function deleteLegacyTotals(shopId: number, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => (await conn.query("DELETE FROM ph_legacy_totals WHERE shop_id = ?", [shopId])).affectedRows > 0);
}
