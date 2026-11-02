"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Landmark, LayoutDashboard, Menu, Receipt, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavGroup = { label: string; items: { href: string; label: string; icon: LucideIcon }[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Tổng hợp",
    items: [{ href: "/consolidated", label: "Báo cáo tổng hợp", icon: LayoutDashboard }],
  },
  {
    label: "Tài chính",
    items: [
      { href: "/", label: "Báo cáo ngày", icon: Receipt },
      { href: "/financial-management", label: "Quản trị tài chính", icon: Landmark },
    ],
  },
  {
    label: "Kinh doanh",
    items: [{ href: "/performance-report", label: "Hiệu suất", icon: BarChart3 }],
  },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Điều hướng chính" className="space-y-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2 pb-1.5 text-xs text-muted-foreground">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-background print:hidden lg:block">
      <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto p-3">
        <SidebarNav />
      </div>
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Mở menu" className="text-white hover:bg-white/10 hover:text-white lg:hidden" />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-3">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="pt-8">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
