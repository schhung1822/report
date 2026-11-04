import { CostDbError, withDb, type Db } from "./db";
import { applyPlanToList, planStaffCost, StaffCostConflict, type StaffCostItem } from "./staff";
import type { CostEntry, CostEntryInput } from "./types";

const BASE_COLUMNS =
  "id, shop_id, scope, channel, staff_name, cost_type, label, amount, period, valid_from, valid_to, note, created_by, updated_at";

const WORK_DAYS_MISSING =
  "Bảng cost_entries chưa có cột work_days (số công chuẩn). Hãy chạy file database/migrations/2026-11-staff-work-days.sql trên database này.";

/**
 * Whether `cost_entries` already has the `work_days` column (database/migrations). Until the migration is run the costs
 * are still read as before, so reports keep working; only saving a cost that needs the column fails, with a clear message.
 * A yes is remembered; a no is checked again on every call, so running the migration needs no restart.
 */
let workDaysColumn = false;
async function supportsWorkDays(conn: Db) {
  if (!workDaysColumn) {
    const { rows } = await conn.query("SHOW COLUMNS FROM cost_entries LIKE 'work_days'");
    workDaysColumn = rows.length > 0;
  }
  return workDaysColumn;
}

async function columnsOf(conn: Db) {
  return (await supportsWorkDays(conn)) ? `${BASE_COLUMNS}, work_days` : BASE_COLUMNS;
}

/** Maps a `cost_entries` row (dates and decimals already plain strings/numbers, see db.ts) to a CostEntry. */
export function toCostEntry(row: Record<string, unknown>): CostEntry {
  const date = (value: unknown) => String(value).slice(0, 10);
  return {
    id: Number(row.id),
    shopId: Number(row.shop_id),
    scope: row.scope as CostEntry["scope"],
    channel: (row.channel as CostEntry["channel"]) ?? null,
    staffName: (row.staff_name as string | null) ?? null,
    costType: row.cost_type as CostEntry["costType"],
    label: String(row.label ?? ""),
    amount: Number(row.amount),
    period: row.period as CostEntry["period"],
    validFrom: date(row.valid_from),
    validTo: row.valid_to == null ? null : date(row.valid_to),
    note: (row.note as string | null) ?? null,
    workDays: row.work_days == null ? null : Number(row.work_days),
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

/** The columns every entry has, in the order of INSERT_FIELDS. */
function values(input: CostEntryInput) {
  return [
    input.shopId,
    input.scope,
    input.channel,
    input.staffName,
    input.costType,
    input.label,
    input.amount,
    input.period,
    input.validFrom,
    input.validTo,
    input.note,
  ];
}
const INSERT_FIELDS = ["shop_id", "scope", "channel", "staff_name", "cost_type", "label", "amount", "period", "valid_from", "valid_to", "note"];

async function requireWorkDaysColumn(conn: Db, needed: boolean) {
  const available = await supportsWorkDays(conn);
  if (needed && !available) throw new CostDbError(WORK_DAYS_MISSING, 503);
  return available;
}

async function insertEntry(conn: Db, input: CostEntryInput, createdBy: string | null) {
  const withWorkDays = await requireWorkDaysColumn(conn, input.workDays !== null);
  const fields = [...INSERT_FIELDS, ...(withWorkDays ? ["work_days"] : []), "created_by"];
  const params = [...values(input), ...(withWorkDays ? [input.workDays] : []), createdBy];
  const { insertId } = await conn.query(
    `INSERT INTO cost_entries (${fields.join(", ")}) VALUES (${params.map(() => "?").join(", ")})`,
    params,
  );
  return insertId;
}

const run = withDb;

export function listEntries(shopId: number, db?: Db) {
  return run(db, async (conn) => {
    const { rows } = await conn.query(
      `SELECT ${await columnsOf(conn)} FROM cost_entries WHERE shop_id = ? ORDER BY valid_from DESC, id DESC`,
      [shopId],
    );
    return rows.map(toCostEntry);
  });
}

/** Entries whose validity window overlaps `from`..`to` (a NULL `valid_to` never ends). */
export function listEntriesInRange(shopId: number, from: string, to: string, db?: Db) {
  return run(db, async (conn) => {
    const { rows } = await conn.query(
      `SELECT ${await columnsOf(conn)} FROM cost_entries
       WHERE shop_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)
       ORDER BY id`,
      [shopId, to, from],
    );
    return rows.map(toCostEntry);
  });
}

async function findEntry(conn: Db, id: number, shopId: number) {
  const { rows } = await conn.query(`SELECT ${await columnsOf(conn)} FROM cost_entries WHERE id = ? AND shop_id = ?`, [id, shopId]);
  return rows[0] ? toCostEntry(rows[0]) : null;
}

export function createEntry(input: CostEntryInput, createdBy: string | null, db?: Db) {
  return run(db, async (conn) => {
    const insertId = await insertEntry(conn, input, createdBy);
    const created = await findEntry(conn, insertId, input.shopId);
    if (!created) throw new CostDbError("Không đọc lại được khoản chi phí vừa lưu.", 500);
    return created;
  });
}

/** Updates an entry of the same shop. Returns null when it does not exist. */
export function updateEntry(id: number, input: CostEntryInput, db?: Db) {
  return run(db, async (conn) => {
    const withWorkDays = await requireWorkDaysColumn(conn, input.workDays !== null);
    await conn.query(
      `UPDATE cost_entries
       SET scope = ?, channel = ?, staff_name = ?, cost_type = ?, label = ?, amount = ?, period = ?,
           valid_from = ?, valid_to = ?, note = ?${withWorkDays ? ", work_days = ?" : ""}
       WHERE id = ? AND shop_id = ?`,
      [...values(input).slice(1), ...(withWorkDays ? [input.workDays] : []), id, input.shopId],
    );
    // affectedRows is unreliable when nothing changed, so the row is read back instead.
    return findEntry(conn, id, input.shopId);
  });
}

/** Deletes an entry of the given shop. Returns false when it does not exist. */
export function deleteEntry(id: number, shopId: number, db?: Db) {
  return run(db, async (conn) => {
    const { affectedRows } = await conn.query("DELETE FROM cost_entries WHERE id = ? AND shop_id = ?", [id, shopId]);
    return affectedRows > 0;
  });
}

/**
 * Makes each item the monthly value of that staff member from `validFrom` (see staff.ts), all in one transaction:
 * either every change is saved or none is. Returns how many items actually changed something.
 * A request the history cannot represent safely fails with a 409 CostDbError.
 */
export function applyStaffCosts(shopId: number, validFrom: string, items: StaffCostItem[], createdBy: string | null, db?: Db) {
  return run(db, (conn) =>
    conn.transaction(async (tx) => {
      const withWorkDays = await requireWorkDaysColumn(tx, items.some((item) => item.workDays !== null));
      const { rows } = await tx.query(`SELECT ${await columnsOf(tx)} FROM cost_entries WHERE shop_id = ? AND scope = 'staff'`, [shopId]);
      let list = rows.map(toCostEntry);
      let changed = 0;

      for (const item of items) {
        let plan;
        try {
          plan = planStaffCost(list, shopId, item, validFrom);
        } catch (error) {
          if (error instanceof StaffCostConflict) throw new CostDbError(error.message, 409);
          throw error;
        }

        for (const closing of plan.close) {
          await tx.query("UPDATE cost_entries SET valid_to = ? WHERE id = ? AND shop_id = ?", [closing.validTo, closing.id, shopId]);
        }
        if (plan.update) {
          await tx.query(`UPDATE cost_entries SET amount = ?${withWorkDays ? ", work_days = ?" : ""} WHERE id = ? AND shop_id = ?`, [
            plan.update.amount,
            ...(withWorkDays ? [plan.update.workDays] : []),
            plan.update.id,
            shopId,
          ]);
        }
        if (plan.remove !== null) await tx.query("DELETE FROM cost_entries WHERE id = ? AND shop_id = ?", [plan.remove, shopId]);
        let newId: number | null = null;
        if (plan.insert) newId = await insertEntry(tx, plan.insert, createdBy);

        if (plan.close.length || plan.update || plan.remove !== null || plan.insert) changed += 1;
        list = applyPlanToList(list, plan, newId);
      }
      return changed;
    }),
  );
}
