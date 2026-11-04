import { getSessionUser } from "@/lib/auth";
import { AdsError, AdsSession, isAdsConfigured } from "@/lib/ads/mcp-client";
import { listAdAccounts } from "@/lib/ads/report";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** The Meta ad accounts the Ads MCP lets us read (name, currency, time zone), for the account pickers. */
export async function POST() {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  if (!isAdsConfigured()) return Response.json({ configured: false, accounts: [] });

  try {
    const accounts = await listAdAccounts(await AdsSession.open());
    return Response.json({ configured: true, accounts });
  } catch (error) {
    if (error instanceof AdsError) return fail(error.message, error.status);
    return fail("Không thể lấy danh sách tài khoản quảng cáo.", 500);
  }
}
