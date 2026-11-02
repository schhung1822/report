import type { Metadata } from "next";
import { WalletCards } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Đăng nhập | Finance Daily",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-neutral-950 text-white">
            <WalletCards className="size-5" aria-hidden="true" />
          </span>
          <p className="text-lg font-semibold tracking-tight">Finance Daily</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Đăng nhập</CardTitle>
            <CardDescription>Nhập thông tin tài khoản để tiếp tục.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
