import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { createEntry, listEntries } from "@/lib/costs/repository";
import { validateCostEntryInput } from "@/lib/costs/validate";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  const shopId = Number(new URL(request.url).searchParams.get("shopId"));
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return fail("Mã shop không hợp lệ.", 400);
  // Not an error: the page shows setup instructions instead.
  if (!isMysqlConfigured()) return Response.json({ configured: false, entries: [] });

  try {
    return Response.json({ configured: true, entries: await listEntries(shopId) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc danh sách chi phí.", 500);
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }

  const parsed = validateCostEntryInput(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    return Response.json({ entry: await createEntry(parsed.value, user) }, { status: 201 });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu khoản chi phí.", 500);
  }
}
