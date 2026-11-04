import { getSessionUser } from "@/lib/auth";
import { CostDbError } from "@/lib/costs/db";
import { getSnapshot } from "@/lib/history/repository";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** One stored report with its full payload. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return fail("Mã báo cáo không hợp lệ.", 400);

  try {
    const found = await getSnapshot(id);
    return found ? Response.json({ snapshot: found.result }) : fail("Không tìm thấy báo cáo này (có thể đã bị xóa).", 404);
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc báo cáo đã lưu.", 500);
  }
}
