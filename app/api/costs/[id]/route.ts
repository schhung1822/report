import { getSessionUser } from "@/lib/auth";
import { CostDbError } from "@/lib/costs/db";
import { deleteEntry, updateEntry } from "@/lib/costs/repository";
import { validateCostEntryInput } from "@/lib/costs/validate";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function parseId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const id = await parseId(params);
  if (id === null) return fail("Mã khoản chi phí không hợp lệ.", 400);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  const parsed = validateCostEntryInput(payload);
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    const entry = await updateEntry(id, parsed.value);
    return entry ? Response.json({ entry }) : fail("Không tìm thấy khoản chi phí này.", 404);
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể cập nhật khoản chi phí.", 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);
  const id = await parseId(params);
  if (id === null) return fail("Mã khoản chi phí không hợp lệ.", 400);
  const shopId = Number(new URL(request.url).searchParams.get("shopId"));
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return fail("Mã shop không hợp lệ.", 400);

  try {
    return (await deleteEntry(id, shopId)) ? Response.json({ ok: true }) : fail("Không tìm thấy khoản chi phí này.", 404);
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể xóa khoản chi phí.", 500);
  }
}
