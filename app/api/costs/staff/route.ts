import { getSessionUser } from "@/lib/auth";
import { CostDbError } from "@/lib/costs/db";
import { applyStaffCosts } from "@/lib/costs/repository";
import { validateStaffCostRequest } from "@/lib/costs/staff";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Sets the monthly salary / fixed cost of several staff members from a date (see lib/costs/staff.ts). */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const parsed = validateStaffCostRequest(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    const changed = await applyStaffCosts(parsed.shopId, parsed.validFrom, parsed.items, user);
    return Response.json({ ok: true, changed });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu chi phí nhân sự.", 500);
  }
}
