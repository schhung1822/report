import type { Ref } from "react";
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarDays, TrendingDown, TrendingUp } from "lucide-react";
import { formatManagementCurrency as formatVnd, NarrativeCard, ProductBars } from "@/components/financial-management/dashboard-sections";
import { cellClass, ReportFooter, ReportHeader, ReportSection, signedTextClass, StatCard, TableFrame, tableHeaderClass } from "@/components/report-ui";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ManagementCharts } from "@/components/charts/report-chart-blocks";
import { CumulativeReconciliationSection } from "@/components/reports/cumulative-reconciliation";
import { cn } from "@/lib/utils";
import { POS_SOURCE_SHEET, type CalculatedChannelMetrics, type ChannelMetricsSet, type ProcessedManagementReport } from "@/types/financial-management";

type BreakdownRow = {
  label: string;
  value: (metrics: CalculatedChannelMetrics) => number;
  /** "head" rows are the main lines, "sub" rows the detail under them, "profit" is the result line. */
  kind: "head" | "sub" | "profit";
};

/** The financial structure of the period, by channel (Zalo, Page) and for the whole shop. */
const BREAKDOWN_ROWS: BreakdownRow[] = [
  { label: "Doanh thu", value: (m) => m.revenue, kind: "head" },
  { label: "Giá vốn", value: (m) => m.cogs, kind: "head" },
  { label: "Dự phòng hoàn", value: (m) => m.returnProvision, kind: "head" },
  { label: "Chi phí nhân sự", value: (m) => m.totalSalary, kind: "head" },
  { label: "Lương Sale/CSKH", value: (m) => m.salarySaleCskh, kind: "sub" },
  { label: "Bộ phận khác", value: (m) => m.salaryOther, kind: "sub" },
  { label: "Chi phí Marketing", value: (m) => m.adsCost, kind: "head" },
  { label: "Định phí & chi phí khác", value: (m) => m.totalFixedCosts, kind: "head" },
  { label: "Định phí", value: (m) => m.fixedCost, kind: "sub" },
  { label: "Chi phí khác", value: (m) => m.otherCost, kind: "sub" },
  { label: "Lợi nhuận", value: (m) => m.profit, kind: "profit" },
];

const percentOf = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
const formatPercent = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);

/**
 * Vietnam management report in VND: revenue, costs and profit of the period. Built from Pancake POS it covers the whole
 * shop (Zalo and Page as one); a report read from a file keeps describing the Zalo (CSKH) channel its sheet is about.
 */
export function VnManagementView({
  report,
  reportRef,
  reconcile,
}: {
  report: ProcessedManagementReport;
  reportRef?: Ref<HTMLDivElement>;
  /** The Pancake shop and the report's last day: when given, the cumulative reconciliation is shown at the bottom. */
  reconcile?: { shopId: number | number[]; to: string };
}) {
  const { summary } = report;
  const wholeShop = report.sourceSheet === POS_SOURCE_SHEET;
  const pick = (set: ChannelMetricsSet) => (wholeShop ? set.total : set.zalo);
  const scope = wholeShop ? "toàn shop (Zalo + Page)" : "nhóm CSKH Zalo";
  const actual = pick(summary.actual);
  const margin = percentOf(actual.profit, actual.revenue);
  const cogsRatio = percentOf(actual.totalCogs, actual.revenue);
  const salaryRatio = percentOf(actual.totalSalary, actual.revenue);
  const adsRatio = percentOf(actual.adsCost, actual.revenue);
  const tone = (value: number) => (value < 0 ? "negative" : "positive");
  const zaloRevenue = summary.actual.zalo.revenue;
  const pageRevenue = summary.actual.page.revenue;
  const channelTotal = zaloRevenue + pageRevenue;
  const channelShare = (value: number) => (channelTotal > 0 ? `${((value / channelTotal) * 100).toFixed(1)}% doanh thu` : "Chưa có doanh thu");

  const byProfit = [...report.days].sort((a, b) => pick(b.actual).profit - pick(a.actual).profit);
  const bestDay = byProfit[0];
  const worstDay = byProfit.at(-1);

  return (
    <div ref={reportRef} className="report-capture min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Executive Financial Review · Việt Nam"
        title="Báo cáo quản trị tài chính Việt Nam"
        subtitle={`${wholeShop ? "Toàn shop (Zalo + Page)" : "Nhóm CSKH Zalo"} · Doanh thu, chi phí và lợi nhuận · VND`}
        metaLabel="Kỳ báo cáo"
        metaValue={summary.dateRangeLabel}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Tổng quan lũy kế" description={`Kết quả kinh doanh của ${scope}`}>
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Doanh thu" value={formatVnd(actual.revenue)} helper={`${report.days.length} ngày có số liệu`} icon={<Banknote />} />
            <StatCard label="Doanh thu Zalo" value={formatVnd(zaloRevenue)} helper={channelShare(zaloRevenue)} />
            <StatCard label="Doanh thu Fanpage" value={formatVnd(pageRevenue)} helper={channelShare(pageRevenue)} />
            <StatCard
              label="Lợi nhuận"
              value={formatVnd(actual.profit)}
              helper={margin === null ? undefined : `Biên lợi nhuận ${formatPercent(margin)}`}
              tone={tone(actual.profit)}
            />
          </div>
        </ReportSection>

        <ManagementCharts
          report={report}
          channel={wholeShop ? "total" : "zalo"}
          label={wholeShop ? "toàn shop" : undefined}
          splitByChannel={false}
          dailyChart={!reconcile}
          compareEstimated={false}
        />

        {report.days.length ? (
          <ReportSection
            index="02"
            title="Cơ cấu tài chính"
            description="Cả kỳ, chia theo kênh Zalo, kênh Page và toàn shop (chi phí chung được phân bổ theo doanh thu từng kênh)"
          >
            <TableFrame>
              <Table>
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Chỉ tiêu</TableHead>
                    <TableHead className="text-right">Kênh Zalo</TableHead>
                    <TableHead className="text-right">Kênh Page</TableHead>
                    <TableHead className="text-right">Toàn shop</TableHead>
                    <TableHead className="text-right">% doanh thu toàn shop</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BREAKDOWN_ROWS.map((row) => {
                    const head = row.kind !== "sub";
                    const profit = row.kind === "profit";
                    const cells = [summary.actual.zalo, summary.actual.page, summary.actual.total].map(row.value);
                    const total = cells[2];
                    return (
                      <TableRow key={row.label}>
                        <TableCell className={cn(cellClass, head ? "font-medium" : "pl-8 text-muted-foreground")}>{row.label}</TableCell>
                        {cells.map((value, index) => (
                          <TableCell
                            key={index}
                            className={cn(
                              cellClass,
                              "text-right tabular-nums",
                              head ? "font-medium" : "text-muted-foreground",
                              index === 2 && head && "font-semibold",
                              profit && signedTextClass(value),
                            )}
                          >
                            {formatVnd(value)}
                          </TableCell>
                        ))}
                        <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>
                          {row.label === "Doanh thu" ? "100%" : formatPercent(percentOf(total, summary.actual.total.revenue))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableFrame>
          </ReportSection>
        ) : null}

        <ReportSection index="03" title="Nhận định quản trị" description="Diễn giải tự động từ số liệu của kỳ">
          <div className="grid grid-cols-3 gap-4">
            <NarrativeCard
              tone={actual.profit < 0 ? "negative" : "positive"}
              icon={actual.profit < 0 ? <TrendingDown /> : <TrendingUp />}
              title={`Biên lợi nhuận ${scope}`}
            >
              Lợi nhuận <strong>{formatVnd(actual.profit)}</strong> trên doanh thu <strong>{formatVnd(actual.revenue)}</strong>, biên{" "}
              <strong>{formatPercent(margin)}</strong>.
            </NarrativeCard>
            <NarrativeCard
              tone={actual.profit < 0 ? "negative" : "neutral"}
              icon={actual.profit < 0 ? <ArrowDownRight /> : <ArrowUpRight />}
              title="Cơ cấu chi phí"
            >
              Giá vốn chiếm <strong>{formatPercent(cogsRatio)}</strong>, lương <strong>{formatPercent(salaryRatio)}</strong> và marketing{" "}
              <strong>{formatPercent(adsRatio)}</strong> doanh thu.
            </NarrativeCard>
            {bestDay && worstDay && bestDay !== worstDay ? (
              <NarrativeCard tone="neutral" icon={<CalendarDays />} title="Ngày nổi bật">
                Lợi nhuận cao nhất ngày <strong>{bestDay.dateLabel.slice(0, 5)}</strong> ({formatVnd(pick(bestDay.actual).profit)}), thấp nhất ngày{" "}
                <strong>{worstDay.dateLabel.slice(0, 5)}</strong> ({formatVnd(pick(worstDay.actual).profit)}).
              </NarrativeCard>
            ) : (
              <NarrativeCard tone="neutral" icon={<Banknote />} title="Kênh bán hàng">
                Zalo chiếm <strong>{formatPercent(percentOf(zaloRevenue, channelTotal))}</strong>, Fanpage chiếm{" "}
                <strong>{formatPercent(percentOf(pageRevenue, channelTotal))}</strong> doanh thu.
              </NarrativeCard>
            )}
          </div>
        </ReportSection>

        <ReportSection index="04" title="Sản phẩm nổi bật" description={`Tổng hợp từ dữ liệu của ${wholeShop ? "toàn shop" : "kênh Zalo"}`}>
          <div className="grid grid-cols-2 gap-5">
            <ProductBars title="Top doanh thu" products={actual.topRevenueProducts.slice(0, 5)} barClass="bg-foreground" />
            <ProductBars title="Top lợi nhuận" products={actual.topProfitProducts.slice(0, 5)} barClass="bg-emerald-500" />
          </div>
        </ReportSection>

        {report.days.length > 1 ? (
          <ReportSection
            index="05"
            title="Kết quả kinh doanh theo ngày"
            description="Doanh thu, chi phí và lợi nhuận từng ngày, kèm lợi nhuận lũy kế"
            className="break-inside-auto"
          >
            <TableFrame>
              <Table className="text-xs">
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Ngày</TableHead>
                    <TableHead className="text-right">Doanh thu</TableHead>
                    <TableHead className="text-right">Giá vốn</TableHead>
                    <TableHead className="text-right">Lương</TableHead>
                    <TableHead className="text-right">Marketing</TableHead>
                    <TableHead className="text-right">Định phí</TableHead>
                    <TableHead className="text-right">Lợi nhuận</TableHead>
                    <TableHead className="text-right">Biên LN</TableHead>
                    <TableHead className="text-right">LN lũy kế</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.days.map((day) => {
                    const metrics = pick(day.actual);
                    return (
                      <TableRow key={day.date} className="break-inside-avoid">
                        <TableCell className={cn(cellClass, "font-medium")}>{day.dateLabel}</TableCell>
                        <Money value={metrics.revenue} />
                        <Money value={metrics.totalCogs} />
                        <Money value={metrics.totalSalary} />
                        <Money value={metrics.adsCost} />
                        <Money value={metrics.totalFixedCosts} />
                        <Money value={metrics.profit} colored />
                        <TableCell className={cn("px-3 py-3 text-right tabular-nums text-muted-foreground")}>
                          {formatPercent(percentOf(metrics.profit, metrics.revenue))}
                        </TableCell>
                        <Money value={pick(day.cumulative.actual).profit} colored />
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className={cn(cellClass, "font-semibold")}>Tổng</TableCell>
                    <Money value={actual.revenue} strong />
                    <Money value={actual.totalCogs} strong />
                    <Money value={actual.totalSalary} strong />
                    <Money value={actual.adsCost} strong />
                    <Money value={actual.totalFixedCosts} strong />
                    <Money value={actual.profit} colored strong />
                    <TableCell className="px-3 py-3 text-right font-semibold tabular-nums">{formatPercent(margin)}</TableCell>
                    <Money value={actual.profit} colored strong />
                  </TableRow>
                </TableFooter>
              </Table>
            </TableFrame>
          </ReportSection>
        ) : null}

        {reconcile ? (
          <CumulativeReconciliationSection index={report.days.length > 1 ? "06" : "05"} shopId={reconcile.shopId} to={reconcile.to} currency="VND" />
        ) : null}

        <ReportFooter
          left={`Nguồn: ${report.sourceSheet} · ${wholeShop ? "toàn shop (Zalo + Page)" : "kênh Zalo (CSKH)"}`}
          right="Đơn vị tiền tệ: Việt Nam Đồng (VND)"
        />
      </div>
    </div>
  );
}

function Money({ value, colored = false, strong = false }: { value: number; colored?: boolean; strong?: boolean }) {
  return (
    <TableCell className={cn("px-3 py-3 text-right tabular-nums", strong && "font-semibold", colored && signedTextClass(value))}>{formatVnd(value)}</TableCell>
  );
}
