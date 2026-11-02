// Server-only Lark (Feishu) client: upload an image, then post it to a group chat as the app's bot.
// Flow: tenant_access_token -> im/v1/images (image_key) -> im/v1/messages (msg_type "image").

// LARK_BASE_URL defaults to the international Lark domain; use https://open.feishu.cn for Feishu (China).
const LARK_BASE_URL = (process.env.LARK_BASE_URL?.trim() || "https://open.larksuite.com").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 30_000;
export const LARK_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class LarkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type LarkConfig = { appId: string; appSecret: string; chatId: string };
type Envelope<T = unknown> = { code?: number; msg?: string; data?: T; tenant_access_token?: string; expire?: number };

/** Reads LARK_APP_ID / LARK_APP_SECRET / LARK_CHAT_ID from .env. Returns the names of missing variables. */
export function readLarkConfig(): { config: LarkConfig } | { missing: string[] } {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  const chatId = process.env.LARK_CHAT_ID?.trim();
  const missing = [
    !appId && "LARK_APP_ID",
    !appSecret && "LARK_APP_SECRET",
    !chatId && "LARK_CHAT_ID",
  ].filter(Boolean) as string[];
  return missing.length ? { missing } : { config: { appId: appId!, appSecret: appSecret!, chatId: chatId! } };
}

const ERROR_MESSAGES: Record<number, string> = {
  10003: "App ID hoặc App Secret Lark không hợp lệ.",
  10014: "App Secret Lark không đúng.",
  230002: "Bot chưa được thêm vào nhóm Lark này. Hãy thêm bot vào nhóm rồi thử lại.",
  230006: "Ứng dụng Lark chưa bật tính năng Bot.",
  230020: "Gửi quá nhanh, Lark đang giới hạn tốc độ. Vui lòng thử lại sau ít phút.",
  230034: "LARK_CHAT_ID không hợp lệ.",
  230035: "Bot không có quyền gửi tin vào nhóm này (ví dụ nhóm đang tắt quyền gửi tin).",
  232009: "Nhóm Lark đã bị giải tán.",
  234006: "Ảnh vượt quá 10 MB, Lark không nhận.",
  234007: "Ứng dụng Lark chưa bật tính năng Bot.",
  234010: "File ảnh rỗng.",
  234011: "Định dạng ảnh không được Lark hỗ trợ.",
  234039: "Độ phân giải ảnh vượt giới hạn của Lark.",
};

// Codes returned when the token is missing/invalid/expired; a fresh token is requested once.
const TOKEN_ERRORS = new Set([99991661, 99991663, 99991668]);

function toError(body: Envelope | null, httpStatus: number, step: string): LarkError {
  const code = body?.code;
  const known = code !== undefined ? ERROR_MESSAGES[code] : undefined;
  if (known) return new LarkError(known, 502);
  if (httpStatus === 429) return new LarkError("Lark đang giới hạn tốc độ. Vui lòng thử lại sau.", 429);
  const detail = body?.msg ? ` (${body.msg}${code ? `, mã ${code}` : ""})` : code ? ` (mã ${code})` : "";
  return new LarkError(`Lark từ chối yêu cầu ở bước ${step}${detail}.`, 502);
}

async function call(url: string, init: RequestInit) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    const body = (await response.json().catch(() => null)) as Envelope | null;
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new LarkError("Lark phản hồi quá lâu. Vui lòng thử lại.", 504);
    }
    throw new LarkError("Không kết nối được tới Lark. Kiểm tra mạng và thử lại.", 502);
  }
}

let cachedToken: { key: string; value: string; expiresAt: number } | null = null;

async function getTenantToken(config: LarkConfig, forceRefresh = false) {
  const key = `${config.appId}:${config.appSecret}`;
  if (!forceRefresh && cachedToken?.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const { status, body } = await call(`${LARK_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  if (!body?.tenant_access_token || body.code) throw toError(body, status, "lấy token");

  // Renew a few minutes early so a token never expires mid-request.
  const lifetimeMs = Math.max(((body.expire ?? 600) - 300) * 1000, 60_000);
  cachedToken = { key, value: body.tenant_access_token, expiresAt: Date.now() + lifetimeMs };
  return cachedToken.value;
}

/** Runs an authenticated request, retrying once with a fresh token if Lark says the token is invalid. */
async function authed<T>(config: LarkConfig, step: string, build: (token: string) => { url: string; init: RequestInit }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getTenantToken(config, attempt > 0);
    const { url, init } = build(token);
    const { status, body } = await call(url, init);
    if (body?.code && TOKEN_ERRORS.has(body.code) && attempt === 0) continue;
    if (!body || body.code !== 0) throw toError(body, status, step);
    return body as Envelope<T>;
  }
  throw new LarkError("Không xác thực được với Lark.", 502);
}

/** Uploads the image and posts it to the configured group. Returns the new message id. */
export async function sendImageToChat(config: LarkConfig, image: Blob, filename: string, uuid: string) {
  const upload = await authed<{ image_key: string }>(config, "tải ảnh lên", (token) => {
    const form = new FormData();
    form.append("image_type", "message");
    form.append("image", image, filename);
    return {
      url: `${LARK_BASE_URL}/open-apis/im/v1/images`,
      init: { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
    };
  });
  const imageKey = upload.data?.image_key;
  if (!imageKey) throw new LarkError("Lark không trả về image_key sau khi tải ảnh lên.", 502);

  const sent = await authed<{ message_id: string }>(config, "gửi tin nhắn", (token) => ({
    url: `${LARK_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        receive_id: config.chatId,
        msg_type: "image",
        content: JSON.stringify({ image_key: imageKey }),
        uuid,
      }),
    },
  }));
  return sent.data?.message_id ?? null;
}
