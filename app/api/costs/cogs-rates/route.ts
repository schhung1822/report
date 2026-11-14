import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { deleteCogsRates, listCogsRates, upsertCogsRates } from "@/lib/costs/cogs-rates-repository";
import { isValidIsoDate } from "@/lib/pancake/dates";
import { invalidatePnlDays } from "@/lib/pnl/repository";
import { validateCogsRates } from "@/lib/pancake/ph-cogs";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readShopId(value: unknown) {
  const shopId = Number(value);
  return Number.isSafeInteger(shopId) && shopId > 0 ? shopId : null;
}

/** The average costs of goods of a shop (?shopId): its saved history, newest first. */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const shopId = readShopId(new URL(request.url).searchParams.get("shopId"));
  if (shopId === null) return fail("Mã shop không hợp lệ.", 400);
  // Not an error: the page shows setup instructions instead.
  if (!isMysqlConfigured()) return Response.json({ configured: false, rates: [] });

  try {
    return Response.json({ configured: true, rates: await listCogsRates(shopId) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc giá vốn theo danh mục.", 500);
  }
}

/** Adds a set of average costs, or changes the one already set for the same effective date. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const shopId = readShopId(payload?.shopId);
  if (shopId === null) return fail("Mã shop không hợp lệ.", 400);
  const parsed = validateCogsRates(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    const rate = await upsertCogsRates(shopId, parsed.value, user);
    await invalidatePnlDays(shopId, parsed.value.effectiveDate);
    return Response.json({ rate });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu giá vốn.", 500);
  }
}

/** Removes the set of average costs that starts on ?effectiveDate. */
export async function DELETE(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const params = new URL(request.url).searchParams;
  const shopId = readShopId(params.get("shopId"));
  const effectiveDate = params.get("effectiveDate");
  if (shopId === null) return fail("Mã shop không hợp lệ.", 400);
  if (!isValidIsoDate(effectiveDate)) return fail("Ngày hiệu lực không hợp lệ.", 400);

  try {
    if (!(await deleteCogsRates(shopId, effectiveDate))) return fail("Không tìm thấy bộ giá vốn này.", 404);
    await invalidatePnlDays(shopId, effectiveDate);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể xóa giá vốn.", 500);
  }
}
