import { CostDbError, withDb, type Db } from "../costs/db";
import type { PancakeSyncResult } from "../pancake/types";
import { MAX_PAYLOAD_BYTES, resultForStorage, summarizeResult, type SnapshotMeta } from "./summary";

const META_COLUMNS =
  "id, shop_id, shop_name, currency, range_from, range_to, day_count, order_count, revenue, warning_count, has_alarm, created_by, created_at";

/** Snapshots with the same shop, range and author created within this window replace each other. */
export const SUPERSEDE_MINUTES = 15;
export const MAX_LIST_LIMIT = 200;
export const MAX_DELETE_IDS = 500;

const date = (value: unknown) => String(value).slice(0, 10);

export function toSnapshotMeta(row: Record<string, unknown>): SnapshotMeta {
  return {
    id: Number(row.id),
    shopId: Number(row.shop_id),
    shopName: String(row.shop_name),
    currency: String(row.currency),
    rangeFrom: date(row.range_from),
    rangeTo: date(row.range_to),
    dayCount: Number(row.day_count),
    orderCount: Number(row.order_count),
    revenue: Number(row.revenue),
    warningCount: Number(row.warning_count),
    hasAlarm: Number(row.has_alarm) === 1,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

/** MySQL's JSON type comes back parsed; MariaDB (JSON = LONGTEXT) and some drivers return a string. */
function parsePayload(value: unknown): PancakeSyncResult {
  if (typeof value === "string") return JSON.parse(value) as PancakeSyncResult;
  return value as PancakeSyncResult;
}

/**
 * Stores a result in the history and returns its row. An earlier snapshot of the same shop and range made by the same
 * user in the last SUPERSEDE_MINUTES is replaced, so re-syncing after a small edit does not pile up duplicates.
 */
export async function saveSnapshot(result: PancakeSyncResult, createdBy: string | null, db?: Db) {
  const json = JSON.stringify(resultForStorage(result));
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new CostDbError("Báo cáo quá lớn để lưu vào lịch sử (hãy chọn khoảng ngày ngắn hơn).", 413);
  }
  const summary = summarizeResult(result);

  return withDb(db, (conn) =>
    conn.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM report_snapshots
         WHERE shop_id = ? AND range_from = ? AND range_to = ? AND created_by <=> ?
           AND created_at >= (NOW() - INTERVAL ${SUPERSEDE_MINUTES} MINUTE)`,
        [summary.shopId, summary.rangeFrom, summary.rangeTo, createdBy],
      );
      const { insertId } = await tx.query(
        `INSERT INTO report_snapshots
           (shop_id, shop_name, currency, range_from, range_to, day_count, order_count, revenue, warning_count, has_alarm, payload, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          summary.shopId,
          summary.shopName,
          summary.currency,
          summary.rangeFrom,
          summary.rangeTo,
          summary.dayCount,
          summary.orderCount,
          summary.revenue,
          summary.warningCount,
          summary.hasAlarm ? 1 : 0,
          json,
          createdBy,
        ],
      );
      const saved = await tx.query(`SELECT ${META_COLUMNS} FROM report_snapshots WHERE id = ?`, [insertId]);
      if (!saved.rows[0]) throw new CostDbError("Không đọc lại được báo cáo vừa lưu.", 500);
      return toSnapshotMeta(saved.rows[0]);
    }),
  );
}

/** Newest first. Never reads the payload. */
export function listSnapshots(options: { currencies?: string[]; shopId?: number; limit?: number } = {}, db?: Db) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), MAX_LIST_LIMIT);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.currencies?.length) {
    conditions.push(`currency IN (${options.currencies.map(() => "?").join(", ")})`);
    params.push(...options.currencies);
  }
  if (options.shopId !== undefined) {
    conditions.push("shop_id = ?");
    params.push(options.shopId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return withDb(db, async (conn) => {
    const { rows } = await conn.query(
      `SELECT ${META_COLUMNS} FROM report_snapshots ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, limit],
    );
    return rows.map(toSnapshotMeta);
  });
}

type StoredSnapshot = { meta: SnapshotMeta; result: PancakeSyncResult };

function withMarker(row: Record<string, unknown>): StoredSnapshot {
  const meta = toSnapshotMeta(row);
  const result = parsePayload(row.payload);
  result.snapshot = { id: meta.id, createdAt: meta.createdAt, restored: true };
  return { meta, result };
}

/** One stored report with its full payload, or null when it does not exist. */
export function getSnapshot(id: number, db?: Db) {
  return withDb(db, async (conn) => {
    const { rows } = await conn.query(`SELECT ${META_COLUMNS}, payload FROM report_snapshots WHERE id = ?`, [id]);
    return rows[0] ? withMarker(rows[0]) : null;
  });
}

/** The most recent report of any shop with this currency, or null. */
export function getLatestSnapshot(currency: string, db?: Db) {
  return withDb(db, async (conn) => {
    const { rows } = await conn.query(
      `SELECT ${META_COLUMNS}, payload FROM report_snapshots WHERE currency = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [currency],
    );
    return rows[0] ? withMarker(rows[0]) : null;
  });
}

/** The most recent report of one shop, or null. */
export function getLatestSnapshotForShop(shopId: number, db?: Db) {
  return withDb(db, async (conn) => {
    const { rows } = await conn.query(
      `SELECT ${META_COLUMNS}, payload FROM report_snapshots WHERE shop_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [shopId],
    );
    return rows[0] ? withMarker(rows[0]) : null;
  });
}

/** Deletes reports by id and returns how many existed. */
export function deleteSnapshots(ids: number[], db?: Db) {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return Promise.resolve(0);
  return withDb(db, async (conn) => {
    const { affectedRows } = await conn.query(`DELETE FROM report_snapshots WHERE id IN (${unique.map(() => "?").join(", ")})`, unique);
    return affectedRows;
  });
}
