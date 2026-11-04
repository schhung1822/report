import { getSessionUser } from "@/lib/auth";
import { AdsError } from "@/lib/ads/mcp-client";
import { fetchAdsReport } from "@/lib/ads/report";
import { MAX_ADS_RANGE_DAYS } from "@/lib/ads/types";
import { addDays, isValidIsoDate } from "@/lib/pancake/dates";

const MAX_ACCOUNTS = 50;
const ACCOUNT_ID = /^act_\d{1,30}$/;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { from?: unknown; to?: unknown; accountIds?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }

  if (!isValidIsoDate(payload.from) || !isValidIsoDate(payload.to)) {
    return fail("Ngày báo cáo không hợp lệ (cần dạng YYYY-MM-DD).", 400);
  }
  if (payload.from > payload.to) return fail("“Từ ngày” phải trước hoặc bằng “Đến ngày”.", 400);
  if (payload.to > addDays(payload.from, MAX_ADS_RANGE_DAYS - 1)) {
    return fail(`Mỗi lần chỉ lấy tối đa ${MAX_ADS_RANGE_DAYS} ngày.`, 400);
  }

  let accountIds: string[] | undefined;
  if (payload.accountIds !== undefined && payload.accountIds !== null) {
    const ids = payload.accountIds;
    if (!Array.isArray(ids) || ids.length > MAX_ACCOUNTS || !ids.every((id) => typeof id === "string" && ACCOUNT_ID.test(id))) {
      return fail("Danh sách tài khoản quảng cáo không hợp lệ.", 400);
    }
    accountIds = ids.length ? (ids as string[]) : undefined;
  }

  try {
    return Response.json(await fetchAdsReport({ from: payload.from, to: payload.to, accountIds }));
  } catch (error) {
    if (error instanceof AdsError) return fail(error.message, error.status);
    return fail("Không thể lấy dữ liệu quảng cáo. Vui lòng thử lại.", 500);
  }
}
