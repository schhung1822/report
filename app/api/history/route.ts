import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { deleteSnapshots, listSnapshots, MAX_DELETE_IDS } from "@/lib/history/repository";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** List of stored reports (newest first, without their payload). ?currency=VND,PHP&shopId=&limit= */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  // Not an error: the UI simply has no history to show.
  if (!isMysqlConfigured()) return Response.json({ configured: false, items: [] });

  const params = new URL(request.url).searchParams;
  const currencies = (params.get("currency") ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]{3}$/.test(value));
  const shopParam = params.get("shopId");
  const shopId = shopParam ? Number(shopParam) : undefined;
  if (shopId !== undefined && (!Number.isSafeInteger(shopId) || shopId <= 0)) return fail("Mã shop không hợp lệ.", 400);
  const limit = Number(params.get("limit")) || 50;

  try {
    return Response.json({ configured: true, items: await listSnapshots({ currencies, shopId, limit }) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc lịch sử báo cáo.", 500);
  }
}

/** Deletes the reports listed in the body: { "ids": [1, 2, 3] }. */
export async function DELETE(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { ids?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const ids = payload.ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > MAX_DELETE_IDS ||
    !ids.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)
  ) {
    return fail(`Cần từ 1 đến ${MAX_DELETE_IDS} mã báo cáo hợp lệ.`, 400);
  }

  try {
    return Response.json({ deleted: await deleteSnapshots(ids as number[]) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể xóa báo cáo.", 500);
  }
}
