"use server";

import { redirect } from "next/navigation";
import { checkCredentials, createSession, destroySession, getAuthConfig } from "@/lib/auth";

export type LoginState = { error?: string; username?: string };

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const config = getAuthConfig();
  if (!config) {
    return { username, error: "Hệ thống chưa cấu hình tài khoản. Hãy khai báo AUTH_USERNAME, AUTH_PASSWORD và AUTH_SECRET (≥ 32 ký tự) trong file .env." };
  }
  if (!username.trim() || !password) {
    return { username, error: "Vui lòng nhập tên đăng nhập và mật khẩu." };
  }
  if (!checkCredentials(config, username, password)) {
    // Small fixed delay to slow down password guessing.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { username, error: "Tên đăng nhập hoặc mật khẩu không đúng." };
  }

  await createSession(config);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
