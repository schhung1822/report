import { costShopId } from "@/lib/pancake/ph-shops";
import type { CogsRatesEntry } from "../pancake/ph-cogs";
import { CostDbError, withDb, type Db } from "./db";

const TABLE_MISSING =
  "Chưa có bảng category_cogs_rates (giá vốn theo danh mục). Hãy chạy file database/migrations/2026-11-category-cogs-rates.sql trên database này.";

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

const COLUMNS = "effective_date, shoes, sets, clothes, updated_by, updated_at";

function toEntry(row: Record<string, unknown>): CogsRatesEntry {
  return {
    effectiveDate: String(row.effective_date).slice(0, 10),
    shoes: Number(row.shoes),
    sets: Number(row.sets),
    clothes: Number(row.clothes),
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

/** Every set of average costs of a shop, newest effective date first. */
export function listCogsRates(shopId: number, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => {
    const { rows } = await conn.query(`SELECT ${COLUMNS} FROM category_cogs_rates WHERE shop_id = ? ORDER BY effective_date DESC`, [shopId]);
    return rows.map(toEntry);
  });
}

/**
 * The same for a report. A database that has no such table yet (the migration was not run) is not an error for a report: the
 * default rates apply. Any other failure still fails the report, like the other costs do.
 */
export async function listCogsRatesForReport(shopId: number, db?: Db) {
  try {
    return await listCogsRates(shopId, db);
  } catch (error) {
    if (error instanceof CostDbError && error.message === TABLE_MISSING) return [];
    throw error;
  }
}

/** Adds a set of average costs, or changes the one already set for the same effective date. */
export function upsertCogsRates(shopId: number, entry: CogsRatesEntry, updatedBy: string | null, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => {
    await conn.query(
      `INSERT INTO category_cogs_rates (shop_id, effective_date, shoes, sets, clothes, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE shoes = VALUES(shoes), sets = VALUES(sets), clothes = VALUES(clothes), updated_by = VALUES(updated_by)`,
      [shopId, entry.effectiveDate, entry.shoes, entry.sets, entry.clothes, updatedBy],
    );
    const { rows } = await conn.query(`SELECT ${COLUMNS} FROM category_cogs_rates WHERE shop_id = ? AND effective_date = ?`, [shopId, entry.effectiveDate]);
    if (!rows[0]) throw new CostDbError("Không đọc lại được giá vốn vừa lưu.", 500);
    return toEntry(rows[0]);
  });
}

/** Returns false when there is no set of average costs for that day. */
export function deleteCogsRates(shopId: number, effectiveDate: string, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => (await conn.query("DELETE FROM category_cogs_rates WHERE shop_id = ? AND effective_date = ?", [shopId, effectiveDate])).affectedRows > 0);
}
