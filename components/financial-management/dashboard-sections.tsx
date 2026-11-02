import type {
  CalculatedChannelMetrics,
  HiddenStatus,
  ProcessedManagementReport,
  ProductMetric,
} from "@/types/financial-management";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CircleDollarSign,
  LayoutGrid,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  cellClass,
  ReportSection,
  signedTextClass,
  StatCard,
  TableFrame,
  tableHeaderClass,
} from "@/components/report-ui";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const vndFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

export function formatManagementCurrency(value: number) {
  return vndFormatter.format(value);
}

export function DashboardContainer({
  children,
  reportRef,
}: {
  children: ReactNode;
  reportRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={reportRef}
      className="min-w-[1120px] bg-white text-foreground shadow-sm print:min-w-0 print:shadow-none"
    >
      {children}
    </div>
  );
}

export function TopMetricsCards({ report }: { report: ProcessedManagementReport }) {
  const actual = report.summary.actual;
  const toneOf = (value: number) => (value < 0 ? "negative" : "positive");
  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard
        label="Tổng doanh thu"
        value={formatManagementCurrency(actual.total.revenue)}
        helper="Doanh thu thực tế toàn kỳ"
        icon={<Banknote />}
      />
      <StatCard
        label="Lợi nhuận ròng"
        value={formatManagementCurrency(actual.total.profit)}
        helper="Sau toàn bộ chi phí"
        icon={<CircleDollarSign />}
        tone={toneOf(actual.total.profit)}
      />
      <StatCard
        label="Lợi nhuận Zalo"
        value={formatManagementCurrency(actual.zalo.profit)}
        helper="Lũy kế kênh Zalo"
        icon={<LayoutGrid />}
        tone={toneOf(actual.zalo.profit)}
      />
      <StatCard
        label="Lợi nhuận Page"
        value={formatManagementCurrency(actual.page.profit)}
        helper="Lũy kế kênh Page"
        icon={<Sparkles />}
        tone={toneOf(actual.page.profit)}
      />
    </div>
  );
}

export function DailyBreakdownTable({ report }: { report: ProcessedManagementReport }) {
  const latest = report.days.at(-1);
  if (!latest) return null;

  const rows: Array<{ label: string; key: keyof CalculatedChannelMetrics; strong?: boolean }> = [
    { label: "Doanh thu", key: "revenue", strong: true },
    { label: "Tổng giá vốn", key: "totalCogs" },
    { label: "Tổng lương", key: "totalSalary" },
    { label: "Chi phí Marketing", key: "adsCost" },
    { label: "Tổng định phí", key: "totalFixedCosts" },
    { label: "Lợi nhuận", key: "profit", strong: true },
  ];

  return (
    <ReportSection
      index="01"
      title="Cơ cấu tài chính ngày gần nhất"
      description={`Số thực tế ngày ${latest.dateLabel}`}
    >
      <TableFrame>
        <Table>
          <TableHeader className={tableHeaderClass}>
            <TableRow className="hover:bg-transparent">
              <TableHead>Chỉ tiêu</TableHead>
              <TableHead className="text-right">Zalo</TableHead>
              <TableHead className="text-right">Page</TableHead>
              <TableHead className="text-right">Toàn hệ thống</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className={cn(cellClass, row.strong ? "font-medium" : "text-muted-foreground")}>
                  {row.label}
                </TableCell>
                <MetricCell value={Number(latest.actual.zalo[row.key])} strong={row.strong} colored={row.key === "profit"} />
                <MetricCell value={Number(latest.actual.page[row.key])} strong={row.strong} colored={row.key === "profit"} />
                <MetricCell value={Number(latest.actual.total[row.key])} strong colored={row.key === "profit"} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
    </ReportSection>
  );
}

function MetricCell({ value, strong = false, colored = false }: { value: number; strong?: boolean; colored?: boolean }) {
  return (
    <TableCell className={cn(cellClass, "text-right tabular-nums", strong && "font-semibold", colored && signedTextClass(value))}>
      {formatManagementCurrency(value)}
    </TableCell>
  );
}

export function PerformanceNarratives({ report }: { report: ProcessedManagementReport }) {
  const summary = report.summary;
  const hiddenLabel = summary.hiddenStatus === "profit" ? "Lãi ngầm" : summary.hiddenStatus === "loss" ? "Lỗ ngầm" : "Cân bằng";
  const weakerChannel = summary.actual.zalo.profit <= summary.actual.page.profit ? "Zalo" : "Page";
  const weakerMetrics = weakerChannel === "Zalo" ? summary.actual.zalo : summary.actual.page;
  const cogsRatio = weakerMetrics.revenue ? (weakerMetrics.totalCogs / weakerMetrics.revenue) * 100 : 0;
  const revenueDirection = summary.revenueDifference >= 0 ? "vượt" : "thấp hơn";

  return (
    <ReportSection index="02" title="Nhận định quản trị" description="Diễn giải tự động từ số liệu lũy kế">
      <div className="grid grid-cols-3 gap-4">
        <NarrativeCard
          tone={summary.hiddenStatus === "loss" ? "negative" : "positive"}
          icon={summary.hiddenStatus === "loss" ? <TrendingDown /> : <TrendingUp />}
          title={`${hiddenLabel} toàn hệ thống`}
        >
          Chênh lệch lợi nhuận lũy kế là <strong>{formatManagementCurrency(summary.profitDifference)}</strong> so với dự tính.
        </NarrativeCard>
        <NarrativeCard
          tone={weakerMetrics.profit < 0 ? "negative" : "neutral"}
          icon={weakerMetrics.profit < 0 ? <ArrowDownRight /> : <ArrowUpRight />}
          title={`Hiệu suất kênh ${weakerChannel}`}
        >
          {weakerMetrics.profit < 0 ? `${weakerChannel} đang kéo lợi nhuận xuống` : `${weakerChannel} có lợi nhuận thấp hơn kênh còn lại`}; tỷ lệ giá vốn là <strong>{cogsRatio.toFixed(1)}%</strong> doanh thu.
        </NarrativeCard>
        <NarrativeCard
          tone={summary.revenueDifference < 0 ? "negative" : "neutral"}
          icon={<Banknote />}
          title="So sánh doanh thu"
        >
          Doanh thu thực tế {revenueDirection} dự tính <strong>{formatManagementCurrency(Math.abs(summary.revenueDifference))}</strong> trong kỳ.
        </NarrativeCard>
      </div>
    </ReportSection>
  );
}

export function NarrativeCard({ tone, icon, title, children }: { tone: "negative" | "positive" | "neutral"; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4",
            tone === "positive" && "bg-emerald-50 text-emerald-600",
            tone === "negative" && "bg-destructive/10 text-destructive",
          )}
        >
          {icon}
        </span>
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">{children}</p>
    </div>
  );
}

export function TopProductsSection({ report }: { report: ProcessedManagementReport }) {
  return (
    <ReportSection index="03" title="Sản phẩm nổi bật" description="Tổng hợp từ dữ liệu thực tế toàn kỳ">
      <div className="grid grid-cols-2 gap-5">
        <ProductBars title="Top doanh thu" products={report.summary.topRevenueProducts} barClass="bg-foreground" />
        <ProductBars title="Top lợi nhuận" products={report.summary.topProfitProducts} barClass="bg-emerald-500" />
      </div>
    </ReportSection>
  );
}

export function ProductBars({ title, products, barClass }: { title: string; products: ProductMetric[]; barClass: string }) {
  const maxValue = Math.max(...products.map((item) => Math.abs(item.value)), 1);
  return (
    <div className="rounded-lg border p-5">
      <h4 className="text-sm font-medium">{title}</h4>
      {products.length ? (
        <div className="mt-5 space-y-4">
          {products.map((product, index) => (
            <div key={`${product.name}-${index}`}>
              <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
                <span className="truncate text-muted-foreground">{index + 1}. {product.name}</span>
                <span className={cn("shrink-0 font-medium tabular-nums", product.value < 0 && "text-destructive")}>
                  {formatManagementCurrency(product.value)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", product.value < 0 ? "bg-destructive" : barClass)}
                  style={{ width: `${Math.max(3, (Math.abs(product.value) / maxValue) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-md bg-muted/50 py-10 text-center text-xs text-muted-foreground">Chưa có dữ liệu sản phẩm</div>
      )}
    </div>
  );
}

export function CumulativeVarianceTable({ report }: { report: ProcessedManagementReport }) {
  const summary = report.summary;
  const groupHead = "border-l text-center";
  return (
    <ReportSection index="04" title="Bảng kiểm toán lũy kế" description="Đối chiếu Dự tính và Thực tế theo từng ngày" className="break-inside-auto">
      <TableFrame>
        <Table className="text-xs">
          <TableHeader className={tableHeaderClass}>
            <TableRow className="hover:bg-transparent">
              <TableHead rowSpan={2}>Ngày</TableHead>
              <TableHead colSpan={3} className={groupHead}>Doanh thu</TableHead>
              <TableHead colSpan={3} className={groupHead}>Lợi nhuận</TableHead>
              <TableHead rowSpan={2} className={groupHead}>Trạng thái lũy kế</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 border-l text-right">Dự tính</TableHead>
              <TableHead className="h-8 text-right">Thực tế</TableHead>
              <TableHead className="h-8 text-right">Chênh lệch</TableHead>
              <TableHead className="h-8 border-l text-right">Dự tính</TableHead>
              <TableHead className="h-8 text-right">Thực tế</TableHead>
              <TableHead className="h-8 text-right">Chênh lệch</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.days.map((day) => {
              const revenueDiff = day.actual.total.revenue - day.estimated.total.revenue;
              const profitDiff = day.actual.total.profit - day.estimated.total.profit;
              return (
                <TableRow key={day.date} className="break-inside-avoid">
                  <TableCell className={cn(cellClass, "font-medium")}>{day.dateLabel}</TableCell>
                  <AuditMoney value={day.estimated.total.revenue} divider />
                  <AuditMoney value={day.actual.total.revenue} />
                  <AuditMoney value={revenueDiff} colored />
                  <AuditMoney value={day.estimated.total.profit} colored divider />
                  <AuditMoney value={day.actual.total.profit} colored />
                  <AuditMoney value={profitDiff} colored />
                  <TableCell className={cn(cellClass, "border-l text-center")}>
                    <StatusBadge status={day.cumulative.hiddenStatus} value={day.cumulative.profitDifference} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className={cn(cellClass, "font-semibold")}>Lũy kế tổng</TableCell>
              <AuditMoney value={summary.estimated.total.revenue} divider strong />
              <AuditMoney value={summary.actual.total.revenue} strong />
              <AuditMoney value={summary.revenueDifference} colored strong />
              <AuditMoney value={summary.estimated.total.profit} colored divider strong />
              <AuditMoney value={summary.actual.total.profit} colored strong />
              <AuditMoney value={summary.profitDifference} colored strong />
              <TableCell className={cn(cellClass, "border-l text-center")}>
                <StatusBadge status={summary.hiddenStatus} value={summary.profitDifference} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableFrame>
    </ReportSection>
  );
}

function AuditMoney({ value, colored = false, divider = false, strong = false }: { value: number; colored?: boolean; divider?: boolean; strong?: boolean }) {
  return (
    <TableCell
      className={cn(
        "px-3 py-3 text-right tabular-nums",
        divider && "border-l",
        strong && "font-semibold",
        colored && signedTextClass(value),
      )}
    >
      {formatManagementCurrency(value)}
    </TableCell>
  );
}

export function StatusBadge({ status, value }: { status: HiddenStatus; value: number }) {
  const label = status === "profit" ? "Lãi ngầm" : status === "loss" ? "Lỗ ngầm" : "Cân bằng";
  return (
    <Badge
      variant={status === "loss" ? "destructive" : "secondary"}
      className={cn("h-auto py-0.5", status === "profit" && "bg-emerald-50 text-emerald-700")}
    >
      {label} · {formatManagementCurrency(value)}
    </Badge>
  );
}
