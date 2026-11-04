import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { RATE_PAIR, validateRateInput } from "@/lib/rates/rates";
import { listRates, upsertRate } from "@/lib/rates/repository";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  // Not an error: the page shows setup instructions instead.
  if (!isMysqlConfigured()) return Response.json({ configured: false, rates: [] });

  try {
    return Response.json({ configured: true, rates: await listRates(RATE_PAIR.from, RATE_PAIR.to) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc danh sách tỷ giá.", 500);
  }
}

/** Adds a rate, or changes the one already set for the same effective date. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const parsed = validateRateInput(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    return Response.json({ rate: await upsertRate(parsed.value, user) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu tỷ giá.", 500);
  }
}
