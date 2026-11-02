import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "@/lib/session-token";

type AuthConfig = { username: string; password: string; secret: string };

/** Reads AUTH_USERNAME / AUTH_PASSWORD / AUTH_SECRET from .env. Returns null when any is missing. */
export function getAuthConfig(): AuthConfig | null {
  const username = process.env.AUTH_USERNAME?.trim();
  const password = process.env.AUTH_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!username || !password || !secret || secret.length < 32) return null;
  return { username, password, secret };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison of two strings (compared as SHA-256 digests so lengths never leak). */
function safeEqual(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}

export function checkCredentials(config: AuthConfig, username: string, password: string) {
  // Evaluate both checks so timing doesn't reveal which one failed.
  const userOk = safeEqual(username.trim().toLowerCase(), config.username.toLowerCase());
  const passwordOk = safeEqual(password, config.password);
  return userOk && passwordOk;
}

export async function createSession(config: AuthConfig) {
  const token = await signSession(config.username, config.secret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Returns the signed-in username, or null. Reads cookies, so call it inside a <Suspense> boundary. */
export async function getSessionUser(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, process.env.AUTH_SECRET);
  return session?.sub ?? null;
}
