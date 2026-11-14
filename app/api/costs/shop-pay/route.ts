import { getSessionUser } from "@/lib/auth";
import { CostDbError } from "@/lib/costs/db";
import { applyShopPay } from "@/lib/costs/repository";
import { validateShopPayRequest } from "@/lib/costs/shop-pay";
import { monthStart } from "@/lib/pancake/dates";
import { invalidatePnlDays } from "@/lib/pnl/repository";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Sets the monthly totals of a shop (salary of Sale/CSKH and of other departments, fixed cost, other fixed cost) from a date (see lib/costs/shop-pay.ts). */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const parsed = validateShopPayRequest(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    const changed = await applyShopPay(parsed.shopId, parsed.validFrom, parsed.items, user);
    await invalidatePnlDays(parsed.shopId, monthStart(parsed.validFrom));
    return Response.json({ ok: true, changed });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu chi phí tổng.", 500);
  }
}
