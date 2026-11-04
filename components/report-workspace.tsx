import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Two-column page body: the report on the left, the configuration on the right.
 *
 * The overall width is the report column (1400px, as before) + the panel + the gap, so the report keeps its width
 * on wide screens. The panel sticks below the header and scrolls on its own when it is taller than the screen.
 * Below `lg` the panel moves above the report.
 */
export function ReportWorkspace({
  header,
  aside,
  children,
}: {
  header: ReactNode;
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[1760px] flex-1 space-y-6 px-4 py-8 sm:px-6">
      {header}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">{children}</div>
        <aside
          aria-label="Cấu hình báo cáo"
          className="w-full shrink-0 max-lg:order-first lg:sticky lg:top-[4.5rem] lg:w-[21rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto print:hidden"
        >
          <div className="divide-y rounded-xl border bg-card text-card-foreground">{aside}</div>
        </aside>
      </div>
    </main>
  );
}

/** One block of the configuration panel. `collapsible` blocks use a native <details>, so they cost no state. */
export function ConfigSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  className,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  if (collapsible) {
    return (
      <details open={defaultOpen} className={cn("group p-3", className)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
          {title}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-2.5 space-y-2.5">{children}</div>
      </details>
    );
  }
  return (
    <section className={cn("space-y-2.5 p-3", className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}
