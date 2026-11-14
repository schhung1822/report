import { costShopId } from "@/lib/pancake/ph-shops";
import { withDb, type Db } from "./db";

/**
 * When the costs that apply to a shop and range were last saved (milliseconds since 1970), or null when nothing was ever
 * saved for them. Covers the accountant's daily cost cells of those days and the monthly entries valid in them (salary, bonus,
 * fixed cost). A report fetched before this moment does not have those costs yet. A deleted line leaves no trace, so deleting
 * is not noticed.
 */
export function latestCostChange(shopId: number, from: string, to: string, db?: Db) {
  shopId = costShopId(shopId);
  return withDb(db, async (conn) => {
    const times: number[] = [];

    const entries = await conn.query(
      `SELECT UNIX_TIMESTAMP(MAX(updated_at)) AS changed FROM cost_entries
       WHERE shop_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)`,
      [shopId, to, from],
    );
    times.push(Number(entries.rows[0]?.changed));

    try {
      const daily = await conn.query("SELECT UNIX_TIMESTAMP(MAX(updated_at)) AS changed FROM daily_costs WHERE shop_id = ? AND cost_date BETWEEN ? AND ?", [shopId, from, to]);
      times.push(Number(daily.rows[0]?.changed));
    } catch (error) {
      // A database without the daily cost table (its migration was never run) simply has no daily costs.
      const { code, errno } = (error ?? {}) as { code?: string; errno?: number };
      if (code !== "ER_NO_SUCH_TABLE" && errno !== 1146) throw error;
    }

    try {
      // Per-order rates (Philippines): a set counts from its effective date on, so it matters when it starts before the range ends.
      const rates = await conn.query("SELECT UNIX_TIMESTAMP(MAX(updated_at)) AS changed FROM order_cost_rates WHERE shop_id = ? AND effective_date <= ?", [shopId, to]);
      times.push(Number(rates.rows[0]?.changed));
    } catch (error) {
      const { code, errno } = (error ?? {}) as { code?: string; errno?: number };
      if (code !== "ER_NO_SUCH_TABLE" && errno !== 1146) throw error;
    }

    try {
      // Average costs of goods per kind (Philippines): a set counts from its effective date on.
      const cogs = await conn.query("SELECT UNIX_TIMESTAMP(MAX(updated_at)) AS changed FROM category_cogs_rates WHERE shop_id = ? AND effective_date <= ?", [shopId, to]);
      times.push(Number(cogs.rows[0]?.changed));
    } catch (error) {
      const { code, errno } = (error ?? {}) as { code?: string; errno?: number };
      if (code !== "ER_NO_SUCH_TABLE" && errno !== 1146) throw error;
    }

    const latest = Math.max(...times.filter((time) => Number.isFinite(time) && time > 0), 0);
    return latest > 0 ? latest * 1000 : null;
  });
}
