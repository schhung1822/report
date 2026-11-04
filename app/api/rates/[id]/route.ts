import { getSessionUser } from "@/lib/auth";
import { CostDbError } from "@/lib/costs/db";
import { deleteRate } from "@/lib/rates/repository";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return fail("Mã tỷ giá không hợp lệ.", 400);

  try {
    return (await deleteRate(id)) ? Response.json({ ok: true }) : fail("Không tìm thấy tỷ giá này.", 404);
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể xóa tỷ giá.", 500);
  }
}
