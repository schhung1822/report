import { getSessionUser } from "@/lib/auth";
import { LARK_MAX_IMAGE_BYTES, LarkError, readLarkConfig, sendImageToChat } from "@/lib/lark";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function hasSignature(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export async function POST(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  const configResult = readLarkConfig();
  if ("missing" in configResult) {
    return fail(`Chưa cấu hình Lark: thiếu ${configResult.missing.join(", ")} trong file .env.`, 503);
  }

  let image: FormDataEntryValue | null;
  try {
    image = (await request.formData()).get("image");
  } catch {
    // A body cut off by a size limit in front of the route (proxy / nginx) no longer parses as a form.
    return fail("Không đọc được ảnh gửi lên (có thể ảnh vượt giới hạn tải lên của máy chủ).", 400);
  }
  if (!(image instanceof File) || image.size === 0) return fail("Chưa có ảnh báo cáo để gửi.", 400);
  if (image.size > LARK_MAX_IMAGE_BYTES) return fail("Ảnh vượt quá 10 MB, Lark không nhận.", 413);

  // Trust the file's content, not the name or declared type the client sent.
  const header = new Uint8Array(await image.slice(0, 8).arrayBuffer());
  if (!hasSignature(header, PNG_SIGNATURE) && !hasSignature(header, JPEG_SIGNATURE)) {
    return fail("Chỉ hỗ trợ gửi ảnh PNG hoặc JPEG.", 415);
  }

  try {
    const messageId = await sendImageToChat(configResult.config, image, image.name || "bao-cao.png", crypto.randomUUID());
    return Response.json({ ok: true, messageId });
  } catch (error) {
    if (error instanceof LarkError) return fail(error.message, error.status);
    return fail("Đã xảy ra lỗi khi gửi tới Lark. Vui lòng thử lại.", 500);
  }
}
