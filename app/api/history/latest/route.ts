import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { getLatestSnapshot, getLatestSnapshotForShop } from "@/lib/history/repository";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** The newest stored report of a shop (?shopId=) or of a currency (?currency=VND), with its full payload; `snapshot: null` when none. */
export async function GET(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  if (!isMysqlConfigured()) return Response.json({ configured: false, snapshot: null });

  const params = new URL(request.url).searchParams;
  const shopParam = params.get("shopId");
  const currency = (params.get("currency") ?? "").trim().toUpperCase();
  const shopId = shopParam ? Number(shopParam) : null;
  if (shopId !== null ? !Number.isSafeInteger(shopId) || shopId <= 0 : !/^[A-Z]{3}$/.test(currency)) {
    return fail("Cần mã shop hoặc tiền tệ hợp lệ.", 400);
  }

  try {
    const found = shopId !== null ? await getLatestSnapshotForShop(shopId) : await getLatestSnapshot(currency);
    return Response.json({ configured: true, snapshot: found?.result ?? null });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc báo cáo đã lưu.", 500);
  }
}
