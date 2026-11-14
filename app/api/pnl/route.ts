import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { addDays, bucketUtcOffset, isValidIsoDate, listDays } from "@/lib/pancake/dates";
import { declaredPhShopIds } from "@/lib/pancake/ph-shops";
import { PancakeError } from "@/lib/pancake/mcp-client";
import { MAX_RANGE_DAYS } from "@/lib/pancake/types";
import { rangeToFetch } from "@/lib/pnl/cache";
import { refreshPnlDays } from "@/lib/pnl/refresh";
import { listPnlDays } from "@/lib/pnl/repository";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

type Range = { ok: true; shopId: number; from: string; to: string } | { ok: false; error: string };

function readRange(shopValue: unknown, from: unknown, to: unknown): Range {
  const shopId = Number(shopValue);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return { ok: false, error: "Mã shop không hợp lệ." };
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return { ok: false, error: "Khoảng ngày không hợp lệ (cần dạng YYYY-MM-DD)." };
  if (from > to) return { ok: false, error: "“Từ ngày” phải trước hoặc bằng “Đến ngày”." };
  if (to > addDays(from, MAX_RANGE_DAYS - 1)) return { ok: false, error: `Mỗi lần chỉ xem tối đa ${MAX_RANGE_DAYS} ngày.` };
  return { ok: true, shopId, from, to };
}

/**
 * The stored days of the profit sheet (?shopId&from&to), and the range that still has to be read from the POS (days never
 * read, or read before they ended). Without MySQL nothing is stored and the whole range has to be read.
 */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const params = new URL(request.url).searchParams;
  const range = readRange(params.get("shopId"), params.get("from"), params.get("to"));
  if (!range.ok) return fail(range.error, 400);
  if (!isMysqlConfigured()) return Response.json({ configured: false, days: [], fetchRange: { from: range.from, to: range.to } });

  try {
    const days = await listPnlDays(range.shopId, range.from, range.to);
    // A Philippines day carries the month-to-date refund rate of the day it was read, so it is read again as the rate moves (cache.ts).
    const fetchRange = rangeToFetch(listDays(range.from, range.to), days, Date.now(), bucketUtcOffset(), declaredPhShopIds().has(range.shopId));
    return Response.json({ configured: true, days, fetchRange });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không đọc được số liệu đã lưu.", 500);
  }
}

/** Reads `from`..`to` from the POS again and stores it: the page's update button, or the days GET said were due. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { shopId?: unknown; from?: unknown; to?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const range = readRange(payload.shopId, payload.from, payload.to);
  if (!range.ok) return fail(range.error, 400);

  try {
    return Response.json(await refreshPnlDays(range, user));
  } catch (error) {
    if (error instanceof PancakeError) return fail(error.message, error.status);
    if (error instanceof CostDbError) return fail(`Không đọc được chi phí từ MySQL: ${error.message}`, error.status);
    return fail("Không thể lấy dữ liệu từ Pancake POS. Vui lòng thử lại.", 500);
  }
}
