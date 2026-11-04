import { getSessionUser } from "@/lib/auth";
import { addDays, isValidIsoDate } from "@/lib/pancake/dates";
import { PancakeError } from "@/lib/pancake/mcp-client";
import { scanStaffFromPancake } from "@/lib/pancake/sync";
import { MAX_RANGE_DAYS } from "@/lib/pancake/types";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Scans the staff of a shop (Vietnam or Philippines) in the POS and what each sold in the range. */
export async function POST(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { from?: unknown; to?: unknown; shopId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }

  if (!isValidIsoDate(payload.from) || !isValidIsoDate(payload.to)) return fail("Ngày không hợp lệ (cần dạng YYYY-MM-DD).", 400);
  if (payload.from > payload.to) return fail("“Từ ngày” phải trước hoặc bằng “Đến ngày”.", 400);
  if (payload.to > addDays(payload.from, MAX_RANGE_DAYS - 1)) return fail(`Mỗi lần chỉ quét tối đa ${MAX_RANGE_DAYS} ngày.`, 400);
  const shopId = Number(payload.shopId);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return fail("Mã shop không hợp lệ.", 400);

  try {
    return Response.json(await scanStaffFromPancake({ shopId, from: payload.from, to: payload.to }));
  } catch (error) {
    if (error instanceof PancakeError) return fail(error.message, error.status);
    return fail("Không thể quét nhân viên từ Pancake POS. Vui lòng thử lại.", 500);
  }
}
