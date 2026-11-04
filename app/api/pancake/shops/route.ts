import { getSessionUser } from "@/lib/auth";
import { PancakeError } from "@/lib/pancake/mcp-client";
import { fetchShops } from "@/lib/pancake/sync";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST() {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  try {
    const { shops, problems } = await fetchShops();
    return Response.json({ shops, problems, defaultShopId: Number(process.env.PANCAKE_SHOP_ID) || null });
  } catch (error) {
    if (error instanceof PancakeError) return fail(error.message, error.status);
    return fail("Không thể lấy danh sách shop từ Pancake POS.", 500);
  }
}
