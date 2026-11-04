import { getSessionUser } from "@/lib/auth";
import { listLabels, replaceLabels, validateLabels } from "@/lib/ads/labels";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** The saved account labels. Without MySQL there is nowhere to keep them: the page then shows setup instructions. */
export async function GET() {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  if (!isMysqlConfigured()) return Response.json({ configured: false, labels: [] });

  try {
    return Response.json({ configured: true, labels: await listLabels() });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc nhãn tài khoản quảng cáo.", 500);
  }
}

/** Saves the whole set of labels (replacing the stored ones). */
export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);
  if (!isMysqlConfigured()) return fail("Chưa cấu hình MySQL nên chưa lưu được nhãn. Điền MYSQL_URL trong .env.local rồi chạy database/schema.sql.", 503);

  let payload: { labels?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const parsed = validateLabels(payload.labels);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    return Response.json({ configured: true, labels: await replaceLabels(parsed.value, user) });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể lưu nhãn tài khoản quảng cáo.", 500);
  }
}
