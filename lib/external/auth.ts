import { createHash, timingSafeEqual } from "node:crypto";

// API key check shared by the routes under /api/external/* (proxy.ts lets them through without a session).

const MIN_KEY_LENGTH = 24;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** The key from "Authorization: Bearer <key>" or "x-api-key: <key>". */
function presentedKey(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer ?? request.headers.get("x-api-key") ?? "").trim();
}

/** Returns an error response when the caller may not use the external API, or null when the key is right. */
export function rejectUnlessAuthorized(request: Request): Response | null {
  const expected = process.env.EXTERNAL_API_KEY?.trim();
  if (!expected || expected.length < MIN_KEY_LENGTH) {
    return Response.json(
      { error: `Chưa cấu hình EXTERNAL_API_KEY (ít nhất ${MIN_KEY_LENGTH} ký tự) trong file .env nên API đang tắt.` },
      { status: 503 },
    );
  }
  // Compared as SHA-256 digests so neither the key nor its length leaks through timing.
  if (!timingSafeEqual(digest(presentedKey(request)), digest(expected))) {
    return Response.json({ error: "API key không hợp lệ." }, { status: 401 });
  }
  return null;
}
