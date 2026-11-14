import { getSessionUser } from "@/lib/auth";
import { latestCostChange } from "@/lib/costs/changes";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { isValidIsoDate } from "@/lib/pancake/dates";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** When the costs that apply to a shop and range were last saved (?shopId&from&to), so a page can tell its report is out of date. */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const params = new URL(request.url).searchParams;
  const shopId = Number(params.get("shopId"));
  const from = params.get("from");
  const to = params.get("to");
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return fail("Mã shop không hợp lệ.", 400);
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) return fail("Khoảng ngày không hợp lệ.", 400);
  if (!isMysqlConfigured()) return Response.json({ changedAt: null });

  try {
    const changed = await latestCostChange(shopId, from, to);
    return Response.json({ changedAt: changed === null ? null : new Date(changed).toISOString() });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không đọc được thời điểm cập nhật chi phí.", 500);
  }
}
