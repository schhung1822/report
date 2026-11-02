"use client";

import { useActionState } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { login, type LoginState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="username">Email hoặc tên đăng nhập</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          defaultValue={state.username}
          className="h-9"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Mật khẩu</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-9" />
      </div>
      <Button type="submit" size="lg" className="h-9 w-full" disabled={isPending}>
        {isPending ? <LoaderCircle className="animate-spin" /> : null}
        Đăng nhập
      </Button>
    </form>
  );
}
