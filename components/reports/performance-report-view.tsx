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
  type SharedPerformanceCosts,
} from "@/lib/performance-report";

const currencyFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** The cost lines of the ledger, in the order they are taken off the revenue. */
const COST_COLUMNS = [
  { key: "cogs", label: "Giá vốn" },
  { key: "shipping", label: "Vận chuyển" },
  { key: "salary", label: "Lương" },
  { key: "ads", label: "Ads" },
] as const;

/** The costs the POS can give for the month to date. */
const CUMULATIVE_COST_COLUMNS = [
  { key: "cogs", label: "Giá vốn" },
  { key: "shipping", label: "Vận chuyển" },
  { key: "ads", label: "Ads" },
] as const;

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function PerformanceReportView({
  dailyRows,
  cumulativeRows,
  sharedCosts,
  reportDate,
  summary,
  onSummaryChange,
  exporting,
  reportRef,
}: {
  dailyRows: DailyPerformanceRow[];
  cumulativeRows: CumulativePerformanceRow[];
  /** Salary and fixed cost of the shop that no staff member carries: shown on a line of their own and counted in the totals. */
  sharedCosts?: SharedPerformanceCosts;
  reportDate: string;
  summary: string;
  onSummaryChange: (value: string) => void;
  /** While exporting, the editable summary is swapped for static text so it renders in the image/PDF. */
  exporting: boolean;
  reportRef?: Ref<HTMLDivElement>;
}) {
  const { overview, rankedDailyRows } = summarizePerformance(dailyRows, sharedCosts);
  const topAgentName = rankedDailyRows[0]?.name;
  const rankedCumulativeRows = [...cumulativeRows].sort((a, b) => b.receivedProfit - a.receivedProfit);
  // The shop's own costs fill the salary and fixed-cost columns of the team total; they have a line of their own below the staff.
  const sharedOf = (key: (typeof COST_COLUMNS)[number]["key"]) => (key === "salary" ? (sharedCosts?.salary ?? 0) : 0);
  // Only the cost columns that have an amount somewhere are shown: a column of dashes says nothing.
  const costColumns = COST_COLUMNS.map((column) => ({
    ...column,
    shared: sharedOf(column.key),
    total: dailyRows.reduce((total, row) => total + row[column.key], 0) + sharedOf(column.key),
  })).filter((column) => column.total !== 0);
  const sharedTotal = (sharedCosts?.salary ?? 0) + (sharedCosts?.fixedCost ?? 0);
  const estimatedReturnTotal = dailyRows.reduce((total, row) => total + row.estimatedReturn, 0);
  const cumulativeCostColumns = CUMULATIVE_COST_COLUMNS.filter((column) => cumulativeRows.some((row) => (row[column.key] ?? 0) !== 0));

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

        <PerformanceCharts dailyRows={dailyRows} sharedCosts={sharedCosts} />

        <ReportSection
          index="02"
          title="Sổ cái hiệu suất nhân sự"
          description="Tổng chi phí gồm các cột bên dưới và định phí (không hiện thành cột riêng) · Lợi nhuận ròng = Doanh thu − Tổng chi phí − Doanh thu hoàn dự tính (10%)"
        >
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>Nhân sự</TableHead>
                  <TableHead className="text-right">Doanh thu</TableHead>
                  {costColumns.map((column) => (
                    <TableHead key={column.key} className="text-right">
                      {column.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Tổng chi phí</TableHead>
                  <TableHead className="text-right">LN gộp</TableHead>
                  <TableHead className="text-right">Hoàn dự tính</TableHead>
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
                    {costColumns.map((column) => (
                      <MoneyCell key={column.key} value={row[column.key]} dimZero muted />
                    ))}
                    <MoneyCell value={row.totalCost} strong />
                    <MoneyCell value={row.grossProfit} colored />
                    <MoneyCell value={row.estimatedReturn} muted />
                    <MoneyCell value={row.netProfit} colored strong />
                  </TableRow>
                ))}
                {sharedTotal > 0 ? (
                  <TableRow className="bg-muted/30">
                    <TableCell className={cellClass} />
                    <TableCell className={`${cellClass} font-medium`}>
                      Chi phí chung của shop
                    </TableCell>
                    <MoneyCell value={0} dimZero />
                    {costColumns.map((column) => (
                      <MoneyCell key={column.key} value={column.shared} dimZero muted />
                    ))}
                    <MoneyCell value={sharedTotal} strong />
                    <MoneyCell value={-sharedTotal} colored />
                    <MoneyCell value={0} dimZero />
                    <MoneyCell value={-sharedTotal} colored strong />
                  </TableRow>
                ) : null}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className={`${cellClass} text-right text-muted-foreground`}>
                    Tổng toàn đội
                  </TableCell>
                  <MoneyCell value={overview.revenue} strong />
                  {costColumns.map((column) => (
                    <MoneyCell key={column.key} value={column.total} strong dimZero />
                  ))}
                  <MoneyCell value={overview.cost} strong />
                  <MoneyCell value={overview.grossProfit} colored strong />
                  <MoneyCell value={estimatedReturnTotal} strong />
                  <MoneyCell value={overview.netProfit} colored strong />
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className={`${cellClass} text-right text-muted-foreground`}>
                    % trên doanh thu
                  </TableCell>
                  <TableCell className={`${cellClass} text-right text-muted-foreground`}>100%</TableCell>
                  {costColumns.map((column) => (
                    <PercentCell key={column.key} value={column.total} base={overview.revenue} />
                  ))}
                  <PercentCell value={overview.cost} base={overview.revenue} />
                  <PercentCell value={overview.grossProfit} base={overview.revenue} />
                  <PercentCell value={estimatedReturnTotal} base={overview.revenue} />
                  <PercentCell value={overview.netProfit} base={overview.revenue} />
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection
          index="03"
          title="Bảng xếp hạng lũy kế tháng"
          description="Xếp hạng giảm dần theo lợi nhuận thực nhận (đơn đã xác nhận trừ đơn hoàn)"
        >
          {rankedCumulativeRows.length ? (
            <TableFrame>
              <Table className="text-xs">
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-16 text-center">Hạng</TableHead>
                    <TableHead>Nhân sự</TableHead>
                    <TableHead className="text-right">Đơn thành công</TableHead>
                    <TableHead className="text-right">DT thực nhận</TableHead>
                    {cumulativeCostColumns.map((column) => (
                      <TableHead key={column.key} className="text-right">
                        {column.label}
                      </TableHead>
                    ))}
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
                      <TableCell className={`${cellClass} text-right tabular-nums`}>
                        {numberFormatter.format(row.successOrders)}
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {row.convRate.toFixed(1)}% / {numberFormatter.format(row.totalOrders)} đơn
                        </span>
                      </TableCell>
                      <MoneyCell value={row.receivedRevenue} />
                      {cumulativeCostColumns.map((column) => (
                        <MoneyCell key={column.key} value={row[column.key] ?? 0} dimZero muted />
                      ))}
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
          {rankedCumulativeRows.length && cumulativeCostColumns.length ? (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Giá vốn, vận chuyển và ads lấy từ POS của các đơn thực nhận trong tháng. Lương và định phí chỉ có ở sổ cái trong ngày (mục 02) nên chưa tính vào lũy kế.
            </p>
          ) : null}
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

function MoneyCell({
  value,
  colored = false,
  strong = false,
  muted = false,
  dimZero = false,
}: {
  value: number;
  colored?: boolean;
  strong?: boolean;
  /** Secondary figure (a cost line): lighter than the headline amounts. */
  muted?: boolean;
  /** Shows a dash for zero. */
  dimZero?: boolean;
}) {
  const empty = dimZero && value === 0;
  return (
    <TableCell
      className={`${cellClass} text-right tabular-nums ${strong ? "font-semibold" : ""} ${empty || (muted && !colored) ? "text-muted-foreground" : ""} ${colored ? signedTextClass(value) : ""}`}
    >
      {empty ? "—" : formatCurrency(value)}
    </TableCell>
  );
}

function PercentCell({ value, base }: { value: number; base: number }) {
  return (
    <TableCell className={`${cellClass} text-right tabular-nums text-muted-foreground`}>
      {base === 0 ? "—" : `${percentFormatter.format((value / base) * 100)}%`}
    </TableCell>
  );
}
