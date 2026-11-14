import { isMysqlConfigured } from "../costs/db";
import { listDays } from "../pancake/dates";
import { syncFromPancake } from "../pancake/sync";
import { savePnlDays, type StoredPnlDay } from "./repository";
import { phDayValues, vnDayValues } from "./sheet";

/**
 * Reads the days `from`..`to` of a shop from the POS (with Meta ads and the stored costs, exactly like a report) and keeps
 * them for the profit sheet. Every day of the range is stored, a day without anything as {}, so it is not read again.
 */
export async function refreshPnlDays(request: { shopId: number; from: string; to: string }, fetchedBy: string | null) {
  const result = await syncFromPancake({ shopId: request.shopId, from: request.from, to: request.to, costs: [] });
  const values = result.phRows ? phDayValues(result.phRows) : result.vn ? vnDayValues(result.vn) : new Map();
  const fetchedAt = new Date().toISOString();
  const days: StoredPnlDay[] = listDays(request.from, request.to).map((date) => ({ date, values: values.get(date) ?? {}, fetchedAt }));

  const warnings = [...result.warnings];
  if (isMysqlConfigured()) {
    try {
      await savePnlDays(result.shop.id, result.shop.currency.toUpperCase(), days, fetchedBy);
    } catch (error) {
      warnings.push(`⚠ Không lưu được số liệu vào MySQL nên lần sau vẫn phải lấy lại từ POS: ${error instanceof Error ? error.message : "lỗi không xác định"}`);
    }
  }
  return { days, warnings, fetchedAt };
}
