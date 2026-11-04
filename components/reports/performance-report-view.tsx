import type { Ref } from "react";
import { AlertCircle, Crown, FileSpreadsheet, Sparkles, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import {
  cellClass,
  ReportFooter,
  ReportHeader,
  ReportSection,
  signedTextClass,
  StatCard,
  tableHeaderClass,
  TableFrame,
} from "@/components/report-ui";
import { PerformanceCharts } from "@/components/charts/report-chart-blocks";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  summarizePerformance,
  type CumulativePerformanceRow,
  type DailyPerformanceRow,
} from "@/lib/performance-report";

const currencyFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function PerformanceReportView({
  dailyRows,
  cumulativeRows,
  reportDate,
  summary,
  onSummaryChange,
  exporting,
  reportRef,
}: {
  dailyRows: DailyPerformanceRow[];
  cumulativeRows: CumulativePerformanceRow[];
  reportDate: string;
  summary: string;
  onSummaryChange: (value: string) => void;
  /** While exporting, the editable summary is swapped for static text so it renders in the image/PDF. */
  exporting: boolean;
  reportRef?: Ref<HTMLDivElement>;
}) {
  const { overview, rankedDailyRows } = summarizePerformance(dailyRows);
  const topAgentName = rankedDailyRows[0]?.name;
  const rankedCumulativeRows = [...cumulativeRows].sort((a, b) => b.receivedProfit - a.receivedProfit);

  return (
    <div ref={reportRef} className="min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Performance Analytics"
        title="Báo cáo hiệu suất kinh doanh"
        subtitle="Hiệu quả nhân sự, cơ cấu doanh thu và lợi nhuận ròng"
        metaLabel="Ngày báo cáo"
        metaValue={reportDate || "Chưa thiết lập"}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Tổng quan trong ngày" description="Tổng hợp tự động từ sổ cái doanh số">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Tổng doanh thu" value={formatCurrency(overview.revenue)} icon={<WalletCards />} />
            <StatCard label="Tổng chi phí" value={formatCurrency(overview.cost)} icon={<TrendingDown />} />
            <StatCard
              label="Lợi nhuận gộp"
              value={formatCurrency(overview.grossProfit)}
              icon={overview.grossProfit >= 0 ? <TrendingUp /> : <TrendingDown />}
              tone={overview.grossProfit >= 0 ? "positive" : "negative"}
            />
            <StatCard
              label="Lợi nhuận ròng"
              value={formatCurrency(overview.netProfit)}
              icon={overview.netProfit >= 0 ? <Sparkles /> : <AlertCircle />}
              tone={overview.netProfit >= 0 ? "positive" : "negative"}
            />
          </div>
        </ReportSection>

        <PerformanceCharts dailyRows={dailyRows} />

        <ReportSection
          index="02"
          title="Sổ cái hiệu suất nhân sự"
          description="Lợi nhuận ròng = Doanh thu − Tổng chi phí − Doanh thu hoàn dự tính (10%)"
        >
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>Nhân sự</TableHead>
                  <TableHead className="text-right">Doanh thu</TableHead>
                  <TableHead className="text-right">Tổng chi phí</TableHead>
                  <TableHead className="text-right">LN gộp</TableHead>
                  <TableHead className="text-right">Hoàn dự tính</TableHead>
                  <TableHead className="text-right">DT sau hoàn</TableHead>
                  <TableHead className="text-right">LN ròng</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyRows.map((row, index) => (
                  <TableRow key={`${row.name}-${index}`}>
                    <TableCell className={`${cellClass} text-center tabular-nums text-muted-foreground`}>{index + 1}</TableCell>
                    <TableCell className={`${cellClass} font-medium`}>
                      <span className="inline-flex items-center gap-2">
                        {row.name}
                        {row.netProfit < 0 ? (
                          <Badge variant="destructive">Âm</Badge>
                        ) : row.name === topAgentName ? (
                          <Badge variant="secondary">Top</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <MoneyCell value={row.revenue} />
                    <MoneyCell value={row.totalCost} />
                    <MoneyCell value={row.grossProfit} colored />
                    <MoneyCell value={row.estimatedReturn} />
                    <MoneyCell value={row.netRevenue} />
                    <MoneyCell value={row.netProfit} colored strong />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className={`${cellClass} text-right text-muted-foreground`}>
                    Tổng toàn đội
                  </TableCell>
                  <MoneyCell value={overview.revenue} strong />
                  <MoneyCell value={overview.cost} strong />
                  <MoneyCell value={overview.grossProfit} colored strong />
                  <MoneyCell value={dailyRows.reduce((total, row) => total + row.estimatedReturn, 0)} strong />
                  <MoneyCell value={dailyRows.reduce((total, row) => total + row.netRevenue, 0)} strong />
                  <MoneyCell value={overview.netProfit} colored strong />
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="03" title="Bảng xếp hạng lũy kế tháng" description="Xếp hạng giảm dần theo lợi nhuận thực nhận">
          {rankedCumulativeRows.length ? (
            <TableFrame>
              <Table className="text-xs">
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-16 text-center">Hạng</TableHead>
                    <TableHead>Nhân sự</TableHead>
                    <TableHead className="text-right">Tổng đơn</TableHead>
                    <TableHead className="text-right">Đơn TC</TableHead>
                    <TableHead className="text-right">Tỷ lệ TC</TableHead>
                    <TableHead className="text-right">DT lên đơn</TableHead>
                    <TableHead className="text-right">LN lên đơn</TableHead>
                    <TableHead className="text-right">DT thực nhận</TableHead>
                    <TableHead className="text-right">LN thực nhận</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankedCumulativeRows.map((row, index) => (
                    <TableRow key={`${row.name}-${index}`}>
                      <TableCell className={`${cellClass} text-center`}>
                        <RankBadge rank={index + 1} />
                      </TableCell>
                      <TableCell className={`${cellClass} font-medium`}>{row.name}</TableCell>
                      <TableCell className={`${cellClass} text-right tabular-nums`}>{numberFormatter.format(row.totalOrders)}</TableCell>
                      <TableCell className={`${cellClass} text-right tabular-nums`}>{numberFormatter.format(row.successOrders)}</TableCell>
                      <TableCell className={`${cellClass} text-right font-medium tabular-nums`}>{row.convRate.toFixed(1)}%</TableCell>
                      <MoneyCell value={row.totalRevenue} />
                      <MoneyCell value={row.totalProfit} colored />
                      <MoneyCell value={row.receivedRevenue} />
                      <MoneyCell value={row.receivedProfit} colored strong />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          ) : (
            <div className="rounded-lg border border-dashed px-6 py-10 text-center">
              <FileSpreadsheet className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Chưa có dữ liệu lũy kế</p>
              <p className="mt-1 text-xs text-muted-foreground">Thêm sheet lũy kế hoặc các cột cumulative vào file nguồn.</p>
            </div>
          )}
        </ReportSection>

        <ReportSection index="04" title="Lời tổng kết" description="Nội dung này được đính kèm trong ảnh và PDF xuất ra">
          {exporting ? (
            <div className="min-h-24 whitespace-pre-wrap rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-6">
              {summary || "Chưa có lời tổng kết."}
            </div>
          ) : (
            <Textarea
              value={summary}
              onChange={(event) => onSummaryChange(event.target.value)}
              rows={4}
              placeholder="Nhập nhận xét tổng kết, điểm nổi bật và kế hoạch hành động..."
              className="min-h-24 bg-muted/30 leading-6"
            />
          )}
        </ReportSection>

        <ReportFooter left="Báo cáo được tạo tự động từ dữ liệu bán hàng" right="Đơn vị tiền tệ: Việt Nam Đồng (VND)" />
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <Badge className="tabular-nums">
        <Crown data-icon="inline-start" />
        1
      </Badge>
    );
  }
  if (rank <= 3) {
    return (
      <Badge variant={rank === 2 ? "secondary" : "outline"} className="tabular-nums">
        {rank}
      </Badge>
    );
  }
  return <span className="tabular-nums text-muted-foreground">{rank}</span>;
}

function MoneyCell({ value, colored = false, strong = false }: { value: number; colored?: boolean; strong?: boolean }) {
  return (
    <TableCell
      className={`${cellClass} text-right tabular-nums ${strong ? "font-semibold" : ""} ${colored ? signedTextClass(value) : ""}`}
    >
      {formatCurrency(value)}
    </TableCell>
  );
}

