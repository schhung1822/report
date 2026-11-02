import type { Ref } from "react";
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
import type { DualCurrencyAmount, ProcessedMonthlyFinanceReport, RefundPerformance } from "@/types/finance";
import { addDualCurrency, formatPeso, formatVnd, getSignedValueTone } from "@/utils/finance";

const percentFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const rateFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

function formatPercent(value: number | null) {
  return value === null ? "—" : `${percentFormatter.format(value)}%`;
}

function describeRate(report: ProcessedMonthlyFinanceReport) {
  const rates = [...report.exchangeRatesUsed].sort((a, b) => a - b);
  if (rates.length <= 1) return `1 ₱ = ${rateFormatter.format(rates[0] ?? report.defaultExchangeRate)} ₫`;
  return `1 ₱ = ${rateFormatter.format(rates[0])}–${rateFormatter.format(rates[rates.length - 1])} ₫ (theo từng ngày)`;
}

function sum(values: DualCurrencyAmount[]) {
  return addDualCurrency(...values);
}

export function PhFinanceView({
  report,
  reportRef,
}: {
  report: ProcessedMonthlyFinanceReport;
  reportRef?: Ref<HTMLDivElement>;
}) {
  const { summary, days } = report;
  const first = days[0];
  const last = days.at(-1);
  const period = !first || !last ? "—" : first.date === last.date ? first.dateLabel : `${first.dateLabel} – ${last.dateLabel}`;

  const totals = {
    revenue: summary.actual.revenue,
    cogs: sum(days.map((day) => day.pnl.cogs)),
    ads: summary.totalAds,
    shipping: sum(days.map((day) => day.pnl.shippingFees)),
    payroll: sum(days.map((day) => day.pnl.payroll)),
    cost: summary.totalSalesCost,
    profit: summary.actual.profit,
  };
  const latestRefund = last?.refund;

  return (
    <div ref={reportRef} className="report-capture min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Executive Financial Review · Philippines"
        title="Báo cáo quản trị tài chính Philippines"
        subtitle={`Bộ phận Sale Chatpage · Peso (₱) quy đổi VND (₫) · ${describeRate(report)}`}
        metaLabel="Kỳ báo cáo"
        metaValue={period}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Tổng quan lũy kế" description="Số thực tế so với dự tính, hiển thị ₱ kèm quy đổi ₫">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Doanh thu thực tế" value={formatPeso(summary.actual.revenue.peso)} helper={`≈ ${formatVnd(summary.actual.revenue.vnd)}`} />
            <StatCard
              label="Lợi nhuận thực tế"
              value={formatPeso(summary.actual.profit.peso)}
              helper={`≈ ${formatVnd(summary.actual.profit.vnd)}`}
              tone={getSignedValueTone(summary.actual.profit.peso)}
            />
            <StatCard
              label="Chênh lệch doanh thu"
              value={signed(formatPeso, summary.variance.revenue.peso)}
              helper={`so với dự tính · ≈ ${formatVnd(summary.variance.revenue.vnd)}`}
              tone={getSignedValueTone(summary.variance.revenue.peso)}
            />
            <StatCard
              label="Chênh lệch lợi nhuận"
              value={signed(formatPeso, summary.variance.profit.peso)}
              helper={`so với dự tính · ≈ ${formatVnd(summary.variance.profit.vnd)}`}
              tone={getSignedValueTone(summary.variance.profit.peso)}
            />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <StatCard label="Chi phí bán hàng" value={formatPeso(summary.totalSalesCost.peso)} helper={`≈ ${formatVnd(summary.totalSalesCost.vnd)}`} />
            <StatCard label="Ads / Doanh thu" value={formatPercent(summary.adsRevenueRatio)} helper={`Ads ${formatPeso(summary.totalAds.peso)}`} />
            <StatCard
              label="Tỷ lệ hoàn ngày gần nhất"
              value={formatPercent(latestRefund?.rate ?? null)}
              helper={latestRefund ? describeRefund(latestRefund) : undefined}
              tone={latestRefund?.status === "good" ? "positive" : latestRefund?.status === "bad" ? "negative" : "default"}
            />
            <StatCard
              label="Dòng tiền ngày gần nhất"
              value={last ? formatPeso(last.cashflow.total.peso) : "—"}
              helper={last ? `≈ ${formatVnd(last.cashflow.total.vnd)}` : undefined}
            />
          </div>
        </ReportSection>

        <ReportSection index="02" title="Dự tính so với Thực tế theo ngày" description="Chênh lệch = Thực tế − Dự tính; trạng thái tính trên lũy kế">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ngày</TableHead>
                  <TableHead className="text-right">Tỷ giá</TableHead>
                  <TableHead className="text-right">DT dự tính</TableHead>
                  <TableHead className="text-right">DT thực tế</TableHead>
                  <TableHead className="text-right">Chênh lệch DT</TableHead>
                  <TableHead className="text-right">LN dự tính</TableHead>
                  <TableHead className="text-right">LN thực tế</TableHead>
                  <TableHead className="text-right">Chênh lệch LN</TableHead>
                  <TableHead className="text-center">Lũy kế</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((day) => {
                  const { estimated, actual } = day.comparison;
                  const cumulative = day.cumulative.variance.profit.peso;
                  return (
                    <TableRow key={`${day.date}-${day.sourceIndex}`} className="break-inside-avoid">
                      <TableCell className={cn(cellClass, "font-medium")}>{day.dateLabel}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>{rateFormatter.format(day.exchangeRate)}</TableCell>
                      <DualCell value={estimated.revenue} />
                      <DualCell value={actual.revenue} />
                      <DualCell value={day.comparison.variance.revenue} colored signedValue />
                      <DualCell value={estimated.profit} colored />
                      <DualCell value={actual.profit} colored />
                      <DualCell value={day.comparison.variance.profit} colored signedValue />
                      <TableCell className={cn(cellClass, "text-center")}>
                        <Badge variant={cumulative < 0 ? "destructive" : "secondary"} className={cn("h-auto py-0.5", cumulative > 0 && "bg-emerald-50 text-emerald-700")}>
                          {cumulative > 0 ? "Lãi ngầm" : cumulative < 0 ? "Lỗ ngầm" : "Cân bằng"} · {signed(formatPeso, cumulative)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className={cn(cellClass, "font-semibold")}>Lũy kế tổng</TableCell>
                  <DualCell value={summary.estimated.revenue} strong />
                  <DualCell value={summary.actual.revenue} strong />
                  <DualCell value={summary.variance.revenue} colored signedValue strong />
                  <DualCell value={summary.estimated.profit} colored strong />
                  <DualCell value={summary.actual.profit} colored strong />
                  <DualCell value={summary.variance.profit} colored signedValue strong />
                  <TableCell className={cellClass} />
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="03" title="Chi phí bán hàng và lợi nhuận" description="Giá vốn + Ads + Vận chuyển + Lương">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ngày</TableHead>
                  <TableHead className="text-right">Doanh thu</TableHead>
                  <TableHead className="text-right">Giá vốn</TableHead>
                  <TableHead className="text-right">Ads</TableHead>
                  <TableHead className="text-right">Vận chuyển</TableHead>
                  <TableHead className="text-right">Lương</TableHead>
                  <TableHead className="text-right">Tổng chi phí</TableHead>
                  <TableHead className="text-right">Lợi nhuận ròng</TableHead>
                  <TableHead className="text-right">Ads / DT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((day) => (
                  <TableRow key={`${day.date}-${day.sourceIndex}`} className="break-inside-avoid">
                    <TableCell className={cn(cellClass, "font-medium")}>{day.dateLabel}</TableCell>
                    <DualCell value={day.pnl.revenue} />
                    <DualCell value={day.pnl.cogs} />
                    <DualCell value={day.pnl.ads} />
                    <DualCell value={day.pnl.shippingFees} />
                    <DualCell value={day.pnl.payroll} />
                    <DualCell value={day.pnl.totalSalesCost} />
                    <DualCell value={day.pnl.netProfit} colored strong />
                    <TableCell className={cn(cellClass, "text-right tabular-nums")}>{formatPercent(day.pnl.adsRevenueRatio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className={cn(cellClass, "font-semibold")}>Tổng</TableCell>
                  <DualCell value={totals.revenue} strong />
                  <DualCell value={totals.cogs} strong />
                  <DualCell value={totals.ads} strong />
                  <DualCell value={totals.shipping} strong />
                  <DualCell value={totals.payroll} strong />
                  <DualCell value={totals.cost} strong />
                  <DualCell value={totals.profit} colored strong />
                  <TableCell className={cn(cellClass, "text-right font-semibold tabular-nums")}>{formatPercent(summary.adsRevenueRatio)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="04" title="Dòng tiền và tỷ lệ hoàn" description="Tỷ lệ hoàn giảm so với ngày trước là tín hiệu tốt">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ngày</TableHead>
                  <TableHead className="text-right">Tiền đang về</TableHead>
                  <TableHead className="text-right">Chưa đối soát</TableHead>
                  <TableHead className="text-right">POS</TableHead>
                  <TableHead className="text-right">Chuyển khoản</TableHead>
                  <TableHead className="text-right">Tổng dòng tiền</TableHead>
                  <TableHead className="text-right">Tỷ lệ hoàn</TableHead>
                  <TableHead className="text-center">So với hôm trước</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((day) => (
                  <TableRow key={`${day.date}-${day.sourceIndex}`} className="break-inside-avoid">
                    <TableCell className={cn(cellClass, "font-medium")}>{day.dateLabel}</TableCell>
                    <DualCell value={day.cashflow.moneyInTransit} />
                    <DualCell value={day.cashflow.unverifiedMoney} />
                    <DualCell value={day.cashflow.pos} />
                    <DualCell value={day.cashflow.transfer} />
                    <DualCell value={day.cashflow.total} strong />
                    <TableCell className={cn(cellClass, "text-right tabular-nums")}>{formatPercent(day.refund.rate)}</TableCell>
                    <TableCell className={cn(cellClass, "text-center")}>
                      <RefundBadge refund={day.refund} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportFooter
          left={`Số liệu gốc bằng Peso (PHP), quy đổi VND theo tỷ giá: ${describeRate(report)}`}
          right="Đơn vị tiền tệ: ₱ / ₫"
        />
      </div>
    </div>
  );
}

function signed(format: (value: number) => string, value: number) {
  return `${value > 0 ? "+" : ""}${format(value)}`;
}

function describeRefund(refund: RefundPerformance) {
  if (refund.delta === null) return "Chưa có ngày trước để so sánh";
  if (refund.trend === "flat") return "Không đổi so với hôm trước";
  return `${refund.trend === "down" ? "Giảm" : "Tăng"} ${percentFormatter.format(Math.abs(refund.delta))} điểm so với hôm trước`;
}

function RefundBadge({ refund }: { refund: RefundPerformance }) {
  if (refund.status === "unavailable") return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant={refund.status === "bad" ? "destructive" : "secondary"}
      className={cn("h-auto py-0.5", refund.status === "good" && "bg-emerald-50 text-emerald-700")}
    >
      {refund.trend === "flat" ? "Không đổi" : `${refund.trend === "down" ? "↓" : "↑"} ${percentFormatter.format(Math.abs(refund.delta ?? 0))} điểm`}
    </Badge>
  );
}

/** One table cell showing a peso amount with its VND equivalent underneath. */
function DualCell({
  value,
  colored = false,
  signedValue = false,
  strong = false,
}: {
  value: DualCurrencyAmount;
  colored?: boolean;
  signedValue?: boolean;
  strong?: boolean;
}) {
  return (
    <TableCell className={cn(cellClass, "text-right tabular-nums")}>
      <span className={cn("block", strong && "font-semibold", colored && signedTextClass(value.peso))}>
        {signedValue ? signed(formatPeso, value.peso) : formatPeso(value.peso)}
      </span>
      <span className="block text-[11px] text-muted-foreground">{signedValue ? signed(formatVnd, value.vnd) : formatVnd(value.vnd)}</span>
    </TableCell>
  );
}
