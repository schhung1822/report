import { CostDbError, withDb, type Db } from "./db";
import { SHEET_LINES, type SheetCell, type SheetChannel, type SheetLine } from "./daily-sheet";

const TABLE_MISSING =
  "Chưa có bảng daily_costs (chi phí kế toán theo ngày). Hãy chạy file database/migrations/2026-11-daily-costs.sql trên database này.";

/** Cells go into the database this many at a time (one multi-row statement each). */
const CHUNK = 250;

const isNoSuchTable = (error: unknown) => {
  const { code, errno } = (error ?? {}) as { code?: string; errno?: number };
  return code === "ER_NO_SUCH_TABLE" || errno === 1146;
};

/** Runs `work`, turning "table does not exist" into a message that says which file to run. */
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

const date = (value: unknown) => String(value).slice(0, 10);
const LINES = new Set<string>(SHEET_LINES);

function toCell(row: Record<string, unknown>): SheetCell | null {
  const line = String(row.line_key);
  if (!LINES.has(line)) return null;
  return { date: date(row.cost_date), channel: String(row.channel ?? "") as SheetChannel, line: line as SheetLine, amount: Number(row.amount) };
}

/** Every stored cell of the shop between two days (inclusive). */
export function listDailyCosts(shopId: number, from: string, to: string, db?: Db) {
  return run(db, async (conn) => {
    const { rows } = await conn.query(
      "SELECT cost_date, channel, line_key, amount FROM daily_costs WHERE shop_id = ? AND cost_date BETWEEN ? AND ? ORDER BY cost_date, channel, line_key",
      [shopId, from, to],
    );
    return rows.map(toCell).filter((cell): cell is SheetCell => cell !== null);
  });
}

/**
 * The same cells for a report. A database that has no such table yet (the migration was not run) is not an error for a
 * report: it simply has no accountant sheet. Any other failure still fails the report, like the other costs do.
 */
export async function listDailyCostsForReport(shopId: number, from: string, to: string, db?: Db) {
  try {
    return await listDailyCosts(shopId, from, to, db);
  } catch (error) {
    if (error instanceof CostDbError && error.message === TABLE_MISSING) return [];
    throw error;
  }
}

/**
 * Saves the cells in one transaction: a cell that exists is overwritten, one that does not is added, every other cell of
 * the shop is left alone. Importing the same file twice therefore changes nothing the second time.
 */
export function saveDailyCosts(shopId: number, cells: SheetCell[], updatedBy: string | null, db?: Db) {
  return run(db, (conn) =>
    conn.transaction(async (tx) => {
      for (let start = 0; start < cells.length; start += CHUNK) {
        const chunk = cells.slice(start, start + CHUNK);
        const params = chunk.flatMap((cell) => [shopId, cell.date, cell.channel, cell.line, cell.amount, updatedBy]);
        await tx.query(
          `INSERT INTO daily_costs (shop_id, cost_date, channel, line_key, amount, updated_by)
           VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
           ON DUPLICATE KEY UPDATE amount = VALUES(amount), updated_by = VALUES(updated_by)`,
          params,
        );
      }
      return cells.length;
    }),
  );
}

/** Deletes every stored cell of the shop between two days. Returns how many were deleted. */
export function deleteDailyCosts(shopId: number, from: string, to: string, db?: Db) {
  return run(db, async (conn) => {
    const { affectedRows } = await conn.query("DELETE FROM daily_costs WHERE shop_id = ? AND cost_date BETWEEN ? AND ?", [shopId, from, to]);
    return affectedRows;
  });
}
