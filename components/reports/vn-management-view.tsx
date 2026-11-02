import type { Ref } from "react";
import { ArrowDownRight, ArrowUpRight, Banknote, TrendingDown, TrendingUp } from "lucide-react";
import {
  formatManagementCurrency as formatVnd,
  NarrativeCard,
  ProductBars,
  StatusBadge,
} from "@/components/financial-management/dashboard-sections";
import {
  cellClass,
  ReportFooter,
  ReportHeader,
  ReportSection,
  signedTextClass,
  StatCard,
  TableFrame,
  tableHeaderClass,
} from "@/components/report-ui";
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
import type { CalculatedChannelMetrics, HiddenStatus, ProcessedManagementReport } from "@/types/financial-management";

function hiddenOf(value: number): HiddenStatus {
  return value > 0 ? "profit" : value < 0 ? "loss" : "balanced";
}

const HIDDEN_LABEL: Record<HiddenStatus, string> = { profit: "Lãi ngầm", loss: "Lỗ ngầm", balanced: "Cân bằng" };

const BREAKDOWN_ROWS: { label: string; key: keyof CalculatedChannelMetrics; strong?: boolean; colored?: boolean }[] = [
  { label: "Doanh thu", key: "revenue", strong: true, colored: true },
  { label: "Tổng giá vốn", key: "totalCogs" },
  { label: "Tổng lương", key: "totalSalary" },
  { label: "Chi phí Marketing", key: "adsCost" },
  { label: "Tổng định phí", key: "totalFixedCosts" },
  { label: "Lợi nhuận", key: "profit", strong: true, colored: true },
];

/** Vietnam management report: the Zalo (CSKH) channel only, Estimated vs Actual, in VND. */
export function VnManagementView({
  report,
  reportRef,
}: {
  report: ProcessedManagementReport;
  reportRef?: Ref<HTMLDivElement>;
}) {
  const { summary } = report;
  const estimated = summary.estimated.zalo;
  const actual = summary.actual.zalo;
  const revenueDiff = actual.revenue - estimated.revenue;
  const profitDiff = actual.profit - estimated.profit;
  const hidden = hiddenOf(profitDiff);
  const latest = report.days.at(-1);
  const cogsRatio = actual.revenue ? (actual.totalCogs / actual.revenue) * 100 : 0;
  const salaryRatio = actual.revenue ? (actual.totalSalary / actual.revenue) * 100 : 0;
  const tone = (value: number) => (value < 0 ? "negative" : "positive");

  return (
    <div ref={reportRef} className="report-capture min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Executive Financial Review · Việt Nam"
        title="Báo cáo quản trị tài chính Việt Nam"
        subtitle="Nhóm CSKH Zalo · Đối chiếu Dự tính – Thực tế · VND"
        metaLabel="Kỳ báo cáo"
        metaValue={summary.dateRangeLabel}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Tổng quan lũy kế" description="Số thực tế so với dự tính của nhóm CSKH Zalo">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Doanh thu thực tế" value={formatVnd(actual.revenue)} helper={`Dự tính ${formatVnd(estimated.revenue)}`} icon={<Banknote />} />
            <StatCard
              label="Lợi nhuận thực tế"
              value={formatVnd(actual.profit)}
              helper={`Dự tính ${formatVnd(estimated.profit)}`}
              tone={tone(actual.profit)}
            />
            <StatCard
              label="Chênh lệch doanh thu"
              value={`${revenueDiff > 0 ? "+" : ""}${formatVnd(revenueDiff)}`}
              helper="Thực tế − Dự tính"
              tone={tone(revenueDiff)}
            />
            <StatCard
              label="Chênh lệch lợi nhuận"
              value={`${profitDiff > 0 ? "+" : ""}${formatVnd(profitDiff)}`}
              helper={HIDDEN_LABEL[hidden]}
              tone={tone(profitDiff)}
            />
          </div>
        </ReportSection>

        {latest ? (
          <ReportSection index="02" title="Cơ cấu tài chính ngày gần nhất" description={`Ngày ${latest.dateLabel}`}>
            <TableFrame>
              <Table>
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Chỉ tiêu</TableHead>
                    <TableHead className="text-right">Dự tính</TableHead>
                    <TableHead className="text-right">Thực tế</TableHead>
                    <TableHead className="text-right">Chênh lệch</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BREAKDOWN_ROWS.map((row) => {
                    const est = Number(latest.estimated.zalo[row.key]);
                    const act = Number(latest.actual.zalo[row.key]);
                    const diff = act - est;
                    return (
                      <TableRow key={row.key}>
                        <TableCell className={cn(cellClass, row.strong ? "font-medium" : "text-muted-foreground")}>{row.label}</TableCell>
                        <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>{formatVnd(est)}</TableCell>
                        <TableCell className={cn(cellClass, "text-right tabular-nums", row.strong && "font-semibold", row.key === "profit" && signedTextClass(act))}>
                          {formatVnd(act)}
                        </TableCell>
                        <TableCell className={cn(cellClass, "text-right tabular-nums", row.colored && signedTextClass(diff))}>
                          {diff > 0 ? "+" : ""}
                          {formatVnd(diff)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableFrame>
          </ReportSection>
        ) : null}

        <ReportSection index="03" title="Nhận định quản trị" description="Diễn giải tự động từ số liệu lũy kế">
          <div className="grid grid-cols-3 gap-4">
            <NarrativeCard
              tone={hidden === "loss" ? "negative" : "positive"}
              icon={hidden === "loss" ? <TrendingDown /> : <TrendingUp />}
              title={`${HIDDEN_LABEL[hidden]} nhóm CSKH Zalo`}
            >
              Lợi nhuận thực tế lũy kế {profitDiff >= 0 ? "cao hơn" : "thấp hơn"} dự tính <strong>{formatVnd(Math.abs(profitDiff))}</strong>.
            </NarrativeCard>
            <NarrativeCard
              tone={actual.profit < 0 ? "negative" : "neutral"}
              icon={actual.profit < 0 ? <ArrowDownRight /> : <ArrowUpRight />}
              title="Cơ cấu chi phí"
            >
              Giá vốn chiếm <strong>{cogsRatio.toFixed(1)}%</strong> và lương chiếm <strong>{salaryRatio.toFixed(1)}%</strong> doanh thu thực tế.
            </NarrativeCard>
            <NarrativeCard tone={revenueDiff < 0 ? "negative" : "neutral"} icon={<Banknote />} title="So sánh doanh thu">
              Doanh thu thực tế {revenueDiff >= 0 ? "vượt" : "thấp hơn"} dự tính <strong>{formatVnd(Math.abs(revenueDiff))}</strong> trong kỳ.
            </NarrativeCard>
          </div>
        </ReportSection>

        <ReportSection index="04" title="Sản phẩm nổi bật" description="Tổng hợp từ dữ liệu thực tế của kênh Zalo">
          <div className="grid grid-cols-2 gap-5">
            <ProductBars title="Top doanh thu" products={actual.topRevenueProducts.slice(0, 5)} barClass="bg-foreground" />
            <ProductBars title="Top lợi nhuận" products={actual.topProfitProducts.slice(0, 5)} barClass="bg-emerald-500" />
          </div>
        </ReportSection>

        <ReportSection index="05" title="Bảng kiểm toán lũy kế" description="Đối chiếu Dự tính và Thực tế theo từng ngày" className="break-inside-auto">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead rowSpan={2}>Ngày</TableHead>
                  <TableHead colSpan={3} className="border-l text-center">Doanh thu</TableHead>
                  <TableHead colSpan={3} className="border-l text-center">Lợi nhuận</TableHead>
                  <TableHead rowSpan={2} className="border-l text-center">Trạng thái lũy kế</TableHead>
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
                  const cumulativeDiff = day.cumulative.actual.zalo.profit - day.cumulative.estimated.zalo.profit;
                  return (
                    <TableRow key={day.date} className="break-inside-avoid">
                      <TableCell className={cn(cellClass, "font-medium")}>{day.dateLabel}</TableCell>
                      <Money value={day.estimated.zalo.revenue} divider />
                      <Money value={day.actual.zalo.revenue} />
                      <Money value={day.actual.zalo.revenue - day.estimated.zalo.revenue} colored />
                      <Money value={day.estimated.zalo.profit} colored divider />
                      <Money value={day.actual.zalo.profit} colored />
                      <Money value={day.actual.zalo.profit - day.estimated.zalo.profit} colored />
                      <TableCell className={cn(cellClass, "border-l text-center")}>
                        <StatusBadge status={hiddenOf(cumulativeDiff)} value={cumulativeDiff} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className={cn(cellClass, "font-semibold")}>Lũy kế tổng</TableCell>
                  <Money value={estimated.revenue} divider strong />
                  <Money value={actual.revenue} strong />
                  <Money value={revenueDiff} colored strong />
                  <Money value={estimated.profit} colored divider strong />
                  <Money value={actual.profit} colored strong />
                  <Money value={profitDiff} colored strong />
                  <TableCell className={cn(cellClass, "border-l text-center")}>
                    <StatusBadge status={hidden} value={profitDiff} />
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportFooter left={`Nguồn: ${report.sourceSheet} · kênh Zalo (CSKH)`} right="Đơn vị tiền tệ: Việt Nam Đồng (VND)" />
      </div>
    </div>
  );
}

function Money({ value, colored = false, divider = false, strong = false }: { value: number; colored?: boolean; divider?: boolean; strong?: boolean }) {
  return (
    <TableCell className={cn("px-3 py-3 text-right tabular-nums", divider && "border-l", strong && "font-semibold", colored && signedTextClass(value))}>
      {formatVnd(value)}
    </TableCell>
  );
}
