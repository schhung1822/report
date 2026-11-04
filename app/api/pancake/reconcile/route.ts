import { getSessionUser } from "@/lib/auth";
import { isValidIsoDate } from "@/lib/pancake/dates";
import { PancakeError } from "@/lib/pancake/mcp-client";
import { RECONCILE_WINDOWS, type ReconcileWindow } from "@/lib/pancake/status";
import { reconcileFromPancake } from "@/lib/pancake/sync";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { to?: unknown; shopId?: unknown; windowDays?: unknown; rate?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }

  if (!isValidIsoDate(payload.to)) return fail("Ngày cuối không hợp lệ (cần dạng YYYY-MM-DD).", 400);
  const windowDays = RECONCILE_WINDOWS.find((days) => days === payload.windowDays);
  if (!windowDays) return fail(`Mốc đối soát phải là ${RECONCILE_WINDOWS.join(", ")} ngày.`, 400);
  const shopId = Number(payload.shopId);
  if (!Number.isSafeInteger(shopId)) return fail("Mã shop không hợp lệ.", 400);

  if (payload.rate !== undefined && !(typeof payload.rate === "number" && payload.rate > 0 && Number.isFinite(payload.rate))) {
    return fail("Tỷ giá không hợp lệ.", 400);
  }

  try {
    return Response.json(
      await reconcileFromPancake({ shopId, to: payload.to, windowDays: windowDays as ReconcileWindow, fallbackRate: payload.rate }),
    );
  } catch (error) {
    if (error instanceof PancakeError) return fail(error.message, error.status);
    return fail("Không thể đối soát lũy kế từ Pancake POS. Vui lòng thử lại.", 500);
  }
}
