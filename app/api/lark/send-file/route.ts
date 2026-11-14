import { getSessionUser } from "@/lib/auth";
import { LARK_MAX_FILE_BYTES, LarkError, readLarkConfig, sendPdfToChat } from "@/lib/lark";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

export async function POST(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  const configResult = readLarkConfig();
  if ("missing" in configResult) {
    return fail(`Chưa cấu hình Lark: thiếu ${configResult.missing.join(", ")} trong file .env.`, 503);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }
  if (!(file instanceof File) || file.size === 0) return fail("Chưa có file PDF để gửi.", 400);
  if (file.size > LARK_MAX_FILE_BYTES) return fail("File PDF vượt quá 30 MB, Lark không nhận.", 413);

  // Trust the file's content, not the name or declared type the client sent.
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!PDF_SIGNATURE.every((value, index) => header[index] === value)) return fail("Chỉ hỗ trợ gửi file PDF.", 415);

  try {
    const messageId = await sendPdfToChat(configResult.config, file, file.name || "bao-cao.pdf", crypto.randomUUID());
    return Response.json({ ok: true, messageId });
  } catch (error) {
    if (error instanceof LarkError) return fail(error.message, error.status);
    return fail("Đã xảy ra lỗi khi gửi tới Lark. Vui lòng thử lại.", 500);
  }
}
