import type { PancakeSyncResult } from "../pancake/types";

/** What the history list shows about a stored report, without reading its (large) payload. */
export type SnapshotMeta = {
  id: number;
  shopId: number;
  shopName: string;
  currency: string;
  /** "YYYY-MM-DD" */
  rangeFrom: string;
  rangeTo: string;
  dayCount: number;
  /** Real orders of the period (confirmed minus returned). */
  orderCount: number;
  /** Real revenue of the period (confirmed minus returned). */
  revenue: number;
  warningCount: number;
  /** True when the cross-checks of that sync found a mismatch. */
  hasAlarm: boolean;
  createdBy: string | null;
  /** As returned by MySQL, "YYYY-MM-DD HH:MM:SS" in the database's time zone. */
  createdAt: string;
};

export type SnapshotSummary = Omit<SnapshotMeta, "id" | "createdBy" | "createdAt">;

export function summarizeResult(result: PancakeSyncResult): SnapshotSummary {
  const { dataset } = result;
  return {
    shopId: result.shop.id,
    shopName: result.shop.name,
    currency: result.shop.currency.toUpperCase(),
    rangeFrom: result.range.from,
    rangeTo: result.range.to,
    dayCount: result.range.dayCount,
    orderCount: Math.max(0, Math.round(dataset.totals.net.orderCount)),
    revenue: dataset.totals.net.revenue,
    warningCount: result.warnings.length,
    hasAlarm: dataset.checks.some((check) => !check.ok),
  };
}

/** The result as it is stored: without the snapshot marker, which only exists once a row has an id. */
export function resultForStorage(result: PancakeSyncResult): PancakeSyncResult {
  const { snapshot: _ignored, ...rest } = result;
  void _ignored;
  return rest;
}

/** Largest payload we are willing to store (MySQL's default max_allowed_packet is 64 MB; stay far below). */
export const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;

/** "2026-11-03 10:20:30" -> "03/11/2026 10:20". */
export function formatCreatedAt(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : value;
}
