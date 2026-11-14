import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { deleteLegacyTotals, getLegacyTotals, saveLegacyTotals } from "@/lib/costs/legacy-totals-repository";
import { validateLegacyTotals } from "@/lib/pancake/legacy-totals";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readShopId(value: unknown) {
  const shopId = Number(value);
  return Number.isSafeInteger(shopId) && shopId > 0 ? shopId : null;
}

/** The totals of the old Philippines shop (?shopId): null when none were saved. */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const shopId = readShopId(new URL(request.url).searchParams.get("shopId"));
  if (shopId === null) return fail("Mã shop không hợp lệ.", 400);
  // Not an error: the page shows setup instructions instead.
  if (!isMysqlConfigured()) return Response.json({ configured: false, totals: null });

  try {
    return Response.json({ configured: true, totals: await getLegacyTotals(shopId) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc số của shop Phil cũ.", 500);
  }
}

/** Saves the totals; a new save replaces the old one. */
export async function PUT(request: Request) {
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
  const parsed = validateLegacyTotals(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    return Response.json({ totals: await saveLegacyTotals(shopId, parsed.value, user) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu số của shop Phil cũ.", 500);
  }
}

/** Removes the totals (?shopId). */
export async function DELETE(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const shopId = readShopId(new URL(request.url).searchParams.get("shopId"));
  if (shopId === null) return fail("Mã shop không hợp lệ.", 400);

  try {
    if (!(await deleteLegacyTotals(shopId))) return fail("Chưa lưu số nào để xóa.", 404);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể xóa số của shop Phil cũ.", 500);
  }
}
