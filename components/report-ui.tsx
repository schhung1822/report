import type { ReactNode } from "react";
import { Download, ImageDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Header row styling shared by every report table. */
export const tableHeaderClass =
  "bg-muted/50 [&_th]:h-10 [&_th]:px-4 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground";
export const cellClass = "px-4 py-3";

export function signedTextClass(value: number) {
  return value < 0 ? "text-destructive" : "text-emerald-600";
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between print:hidden">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function ExportButtons({
  exporting,
  onImage,
  onPdf,
  imageLabel = "Xuất ảnh",
}: {
  exporting: "image" | "pdf" | null;
  onImage: () => void;
  onPdf: () => void;
  imageLabel?: string;
}) {
  return (
    <>
      <Button variant="outline" size="lg" disabled={exporting !== null} onClick={onImage}>
        {exporting === "image" ? <LoaderCircle className="animate-spin" /> : <ImageDown />}
        {imageLabel}
      </Button>
      <Button size="lg" disabled={exporting !== null} onClick={onPdf}>
        {exporting === "pdf" ? <LoaderCircle className="animate-spin" /> : <Download />}
        Xuất PDF
      </Button>
    </>
  );
}

/** Scrollable stage that frames the white report sheet. */
export function ReportViewport({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/60 p-3 sm:p-6 print:overflow-visible print:border-0 print:bg-transparent print:p-0">
      {children}
    </div>
  );
}

export function ReportHeader({
  eyebrow,
  title,
  subtitle,
  metaLabel,
  metaValue,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  metaLabel: string;
  metaValue: string;
}) {
  return (
    <div className="flex items-end justify-between gap-8 border-b px-10 py-8">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-muted-foreground">{metaLabel}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{metaValue}</p>
      </div>
    </div>
  );
}

export function ReportSection({
  index,
  title,
  description,
  children,
  className,
}: {
  index: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("break-inside-avoid", className)}>
      <div className="mb-4 flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{index}</span>
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        </div>
        {description ? <p className="text-right text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ReportFooter({ left, right }: { left: string; right: string }) {
  return (
    <footer className="flex items-center justify-between border-t pt-5 text-xs text-muted-foreground">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}

export function TableFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-lg border", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  helper,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  helper?: string;
  icon?: ReactNode;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <Card size="sm" className="break-inside-avoid shadow-none">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <p className="text-xs font-medium">{label}</p>
          {icon ? <span className="[&_svg]:size-4">{icon}</span> : null}
        </div>
        <p
          className={cn(
            "text-xl font-semibold tabular-nums tracking-tight",
            tone === "positive" && "text-emerald-600",
            tone === "negative" && "text-destructive",
          )}
        >
          {value}
        </p>
        {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}
