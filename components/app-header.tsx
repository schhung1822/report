import { Suspense } from "react";
import Link from "next/link";
import { LogOut, UserRound, WalletCards } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { MobileNav } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-white/10 bg-neutral-950 text-white print:hidden">
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <MobileNav />
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-white text-neutral-950">
              <WalletCards className="size-4" aria-hidden="true" />
            </span>
            NextG
          </Link>
        </div>
        <Suspense fallback={<div className="h-9 w-40 animate-pulse rounded-lg bg-white/10" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

async function UserMenu() {
  const username = await getSessionUser();
  if (!username) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 sm:flex">
        <UserRound className="size-4 text-white/70" aria-hidden="true" />
        <div className="text-xs leading-tight">
          <p className="font-medium">Tài khoản</p>
          <p className="max-w-44 truncate text-white/60">{username}</p>
        </div>
      </div>
      <form action={logout}>
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-label="Đăng xuất"
          title="Đăng xuất"
          className="text-white hover:bg-white/10 hover:text-white"
        >
          <LogOut />
        </Button>
      </form>
    </div>
  );
}
