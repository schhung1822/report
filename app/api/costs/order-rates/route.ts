import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { deleteOrderRates, listOrderRates, upsertOrderRates } from "@/lib/costs/order-rates-repository";
import { isValidIsoDate } from "@/lib/pancake/dates";
import { invalidatePnlDays } from "@/lib/pnl/repository";
import { DEFAULT_PER_ORDER_RATES, validatePerOrderRates } from "@/lib/pancake/ph-order-costs";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readShopId(value: unknown) {
  const shopId = Number(value);
  return Number.isSafeInteger(shopId) && shopId > 0 ? shopId : null;
}

/** The per-order rates of a shop (?shopId): its saved history, newest first, and the defaults used before one is saved. */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const shopId = readShopId(new URL(request.url).searchParams.get("shopId"));
  if (shopId === null) return fail("Mã shop không hợp lệ.", 400);
  // Not an error: the page shows setup instructions instead.
  if (!isMysqlConfigured()) return Response.json({ configured: false, rates: [], defaults: DEFAULT_PER_ORDER_RATES });

  try {
    return Response.json({ configured: true, rates: await listOrderRates(shopId), defaults: DEFAULT_PER_ORDER_RATES });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc đơn giá chi phí theo sản phẩm.", 500);
  }
}

/** Adds a set of rates, or changes the one already set for the same effective date. */
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
  const parsed = validatePerOrderRates(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    const rate = await upsertOrderRates(shopId, parsed.value, user);
    await invalidatePnlDays(shopId, parsed.value.effectiveDate);
    return Response.json({ rate });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu đơn giá.", 500);
  }
}

/** Removes the set of rates that starts on ?effectiveDate. */
export async function DELETE(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const params = new URL(request.url).searchParams;
  const shopId = readShopId(params.get("shopId"));
  const effectiveDate = params.get("effectiveDate");
  if (shopId === null) return fail("Mã shop không hợp lệ.", 400);
  if (!isValidIsoDate(effectiveDate)) return fail("Ngày hiệu lực không hợp lệ.", 400);

  try {
    if (!(await deleteOrderRates(shopId, effectiveDate))) return fail("Không tìm thấy bộ đơn giá này.", 404);
    await invalidatePnlDays(shopId, effectiveDate);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể xóa đơn giá.", 500);
  }
}
