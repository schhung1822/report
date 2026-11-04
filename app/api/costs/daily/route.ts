import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { deleteDailyCosts, listDailyCosts, saveDailyCosts } from "@/lib/costs/daily-repository";
import { MAX_SHEET_DAYS, validateSheetCells, type SheetMarket } from "@/lib/costs/daily-sheet";
import { addDays, isValidIsoDate } from "@/lib/pancake/dates";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

type Range = { ok: true; shopId: number; from: string; to: string } | { ok: false; error: string };

/** `shopId`, `from` and `to` of a query string, checked. */
function readRange(params: URLSearchParams): Range {
  const shopId = Number(params.get("shopId"));
  const from = params.get("from");
  const to = params.get("to");
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return { ok: false, error: "Mã shop không hợp lệ." };
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return { ok: false, error: "Khoảng ngày không hợp lệ (cần dạng YYYY-MM-DD)." };
  if (from > to) return { ok: false, error: "“Từ ngày” phải trước hoặc bằng “Đến ngày”." };
  if (to > addDays(from, MAX_SHEET_DAYS - 1)) return { ok: false, error: `Chỉ xem tối đa ${MAX_SHEET_DAYS} ngày mỗi lần.` };
  return { ok: true, shopId, from, to };
}

export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const range = readRange(new URL(request.url).searchParams);
  if (!range.ok) return fail(range.error, 400);
  if (!isMysqlConfigured()) return Response.json({ configured: false, cells: [] });

  try {
    return Response.json({ configured: true, cells: await listDailyCosts(range.shopId, range.from, range.to) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc bảng chi phí theo ngày.", 500);
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { shopId?: unknown; market?: unknown; cells?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }

  const shopId = Number(payload.shopId);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return fail("Mã shop không hợp lệ.", 400);
  if (payload.market !== "VND" && payload.market !== "PHP") return fail("Loại shop không hợp lệ.", 400);
  const parsed = validateSheetCells(payload.cells, payload.market as SheetMarket);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    return Response.json({ saved: await saveDailyCosts(shopId, parsed.cells, user) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu bảng chi phí theo ngày.", 500);
  }
}

export async function DELETE(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const range = readRange(new URL(request.url).searchParams);
  if (!range.ok) return fail(range.error, 400);

  try {
    return Response.json({ deleted: await deleteDailyCosts(range.shopId, range.from, range.to) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể xoá bảng chi phí theo ngày.", 500);
  }
}
