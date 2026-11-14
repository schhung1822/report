import { costShopId } from "@/lib/pancake/ph-shops";
import type { PerOrderRatesEntry } from "../pancake/ph-order-costs";
import { CostDbError, withDb, type Db } from "./db";

const TABLE_MISSING =
  "Chưa có bảng order_cost_rates (đơn giá chi phí theo sản phẩm). Hãy chạy file database/migrations/2026-11-order-cost-rates.sql trên database này.";

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

const COLUMNS = "effective_date, outsourced, shipping_ped_ph, shipping_ph, other_cost, tax_fee, updated_by, updated_at";

function toEntry(row: Record<string, unknown>): PerOrderRatesEntry {
  return {
    effectiveDate: String(row.effective_date).slice(0, 10),
    outsourced: Number(row.outsourced),
    shippingPedPh: Number(row.shipping_ped_ph),
    shippingPh: Number(row.shipping_ph),
    other: Number(row.other_cost),
    tax: Number(row.tax_fee),
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

/** Every set of rates of a shop, newest effective date first. */
export function listOrderRates(shopId: number, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => {
    const { rows } = await conn.query(`SELECT ${COLUMNS} FROM order_cost_rates WHERE shop_id = ? ORDER BY effective_date DESC`, [shopId]);
    return rows.map(toEntry);
  });
}

/**
 * The same for a report. A database that has no such table yet (the migration was not run) is not an error for a report: the
 * default rates apply. Any other failure still fails the report, like the other costs do.
 */
export async function listOrderRatesForReport(shopId: number, db?: Db) {
  try {
    return await listOrderRates(shopId, db);
  } catch (error) {
    if (error instanceof CostDbError && error.message === TABLE_MISSING) return [];
    throw error;
  }
}

/** Adds a set of rates, or changes the one already set for the same effective date. */
export function upsertOrderRates(shopId: number, entry: PerOrderRatesEntry, updatedBy: string | null, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => {
    await conn.query(
      `INSERT INTO order_cost_rates (shop_id, effective_date, outsourced, shipping_ped_ph, shipping_ph, other_cost, tax_fee, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE outsourced = VALUES(outsourced), shipping_ped_ph = VALUES(shipping_ped_ph), shipping_ph = VALUES(shipping_ph),
         other_cost = VALUES(other_cost), tax_fee = VALUES(tax_fee), updated_by = VALUES(updated_by)`,
      [shopId, entry.effectiveDate, entry.outsourced, entry.shippingPedPh, entry.shippingPh, entry.other, entry.tax, updatedBy],
    );
    const { rows } = await conn.query(`SELECT ${COLUMNS} FROM order_cost_rates WHERE shop_id = ? AND effective_date = ?`, [shopId, entry.effectiveDate]);
    if (!rows[0]) throw new CostDbError("Không đọc lại được đơn giá vừa lưu.", 500);
    return toEntry(rows[0]);
  });
}

/** Returns false when there is no set of rates for that day. */
export function deleteOrderRates(shopId: number, effectiveDate: string, db?: Db) {
  shopId = costShopId(shopId);
  return run(db, async (conn) => (await conn.query("DELETE FROM order_cost_rates WHERE shop_id = ? AND effective_date = ?", [shopId, effectiveDate])).affectedRows > 0);
}
