import { CostDbError, withDb, type Db } from "../costs/db";
import type { ExchangeRateEntry, ExchangeRateInput } from "./rates";

const COLUMNS = "id, from_currency, to_currency, rate, effective_date, note, created_by, updated_at";

export function toRateEntry(row: Record<string, unknown>): ExchangeRateEntry {
  return {
    id: Number(row.id),
    fromCurrency: String(row.from_currency),
    toCurrency: String(row.to_currency),
    rate: Number(row.rate),
    effectiveDate: String(row.effective_date).slice(0, 10),
    note: (row.note as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

/** The whole history of a pair, newest effective date first. */
export function listRates(fromCurrency: string, toCurrency: string, db?: Db) {
  return withDb(db, async (conn) => {
    const { rows } = await conn.query(
      `SELECT ${COLUMNS} FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY effective_date DESC, id DESC`,
      [fromCurrency, toCurrency],
    );
    return rows.map(toRateEntry);
  });
}

/** Adds a rate, or changes the one that already exists for the same pair and effective date. */
export function upsertRate(input: ExchangeRateInput, createdBy: string | null, db?: Db) {
  return withDb(db, (conn) =>
    conn.transaction(async (tx) => {
      const existing = await tx.query(
        "SELECT id FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND effective_date = ?",
        [input.fromCurrency, input.toCurrency, input.effectiveDate],
      );
      let id: number;
      if (existing.rows[0]) {
        id = Number(existing.rows[0].id);
        await tx.query("UPDATE exchange_rates SET rate = ?, note = ? WHERE id = ?", [input.rate, input.note, id]);
      } else {
        id = (
          await tx.query(
            "INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            [input.fromCurrency, input.toCurrency, input.rate, input.effectiveDate, input.note, createdBy],
          )
        ).insertId;
      }
      const saved = await tx.query(`SELECT ${COLUMNS} FROM exchange_rates WHERE id = ?`, [id]);
      if (!saved.rows[0]) throw new CostDbError("Không đọc lại được tỷ giá vừa lưu.", 500);
      return toRateEntry(saved.rows[0]);
    }),
  );
}

/** Returns false when the rate does not exist. */
export function deleteRate(id: number, db?: Db) {
  return withDb(db, async (conn) => (await conn.query("DELETE FROM exchange_rates WHERE id = ?", [id])).affectedRows > 0);
}
