import type { ReactNode, Ref } from "react";
import { CircleCheck, PackageOpen, Truck } from "lucide-react";
import { cellClass, ReportFooter, ReportHeader, ReportSection, signedTextClass, StatCard, TableFrame, tableHeaderClass } from "@/components/report-ui";
import { PhilippinesCharts } from "@/components/charts/report-chart-blocks";
import { CumulativeReconciliationSection } from "@/components/reports/cumulative-reconciliation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, toDmy } from "@/lib/pancake/dates";
import { latestOfMonth, monthToDateRate, refundRate, type CumulativePoint, type RefundCumulative, type RefundPoint, type RefundTrend } from "@/lib/pancake/refund";
import type { OpenOrders, PreviousDay } from "@/lib/pancake/types";
import { localDate } from "@/lib/range-presets";
import { cn } from "@/lib/utils";
import type { DualCurrencyAmount, ProcessedDailyFinance, ProcessedMonthlyFinanceReport } from "@/types/finance";
import { addDualCurrency, formatPeso, formatVnd, getSignedValueTone, subtractDualCurrency, toDualCurrency } from "@/utils/finance";

const percentFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const rateFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const countFormatter = new Intl.NumberFormat("vi-VN");

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

/** The peso amount that sits under every VND figure, in brackets. */
function pesoNote(value: DualCurrencyAmount, signedValue = false) {
  return `(${signedValue ? signed(formatPeso, value.peso) : formatPeso(value.peso)})`;
}

function shareOf(part: number, whole: number) {
  return whole === 0 ? null : (part / whole) * 100;
}

export function PhFinanceView({
  report,
  reportRef,
  reconcile,
  previousDay,
  refundTrend,
  openOrders,
  mergedShops,
}: {
  report: ProcessedMonthlyFinanceReport;
  reportRef?: Ref<HTMLDivElement>;
  /** The money in circulation by order status when the data was read; without it the card shows the day's own COD. */
  openOrders?: OpenOrders;
  /** Month-to-date refund figures: the refund rate is returned revenue / successful revenue added up from the 1st of the month. */
  refundTrend?: RefundTrend;
  /** The day before the report's last day, read separately when the range does not contain it (a one-day report). */
  previousDay?: PreviousDay;
  /** The Pancake shop and the report's last day: when given, the cumulative reconciliation is shown at the bottom. */
  reconcile?: { shopId: number | number[]; to: string };
  /** Names of the shops added together in this report (two or more): shown under the title. */
  mergedShops?: string[];
}) {
  const { summary, days } = report;
  const first = days[0];
  const last = days.at(-1);
  const period = !first || !last ? "—" : first.date === last.date ? first.dateLabel : `${first.dateLabel} – ${last.dateLabel}`;

  const total = (pick: (day: ProcessedDailyFinance) => DualCurrencyAmount) => sum(days.map(pick));
  const revenue = summary.actual.revenue;
  const provision = total((day) => day.pnl.provision);
  const netRevenue = subtractDualCurrency(revenue, provision);
  const cogs = total((day) => day.pnl.cogs);
  const grossProfit = subtractDualCurrency(netRevenue, cogs);
  const ads = summary.totalAds;
  const shipping = total((day) => day.pnl.shippingFees);
  const payroll = total((day) => day.pnl.payroll);
  const outsourced = total((day) => day.pnl.outsourcedServices);
  const other = total((day) => day.pnl.otherCost);
  const sellingCost = sum([ads, outsourced, shipping, payroll, other]);
  // Taxes, fees and charges are an administration cost, taken off after the selling costs.
  const taxFee = total((day) => day.pnl.taxFee);
  const hasTax = Math.abs(taxFee.peso) >= 0.5;
  const computedProfit = subtractDualCurrency(subtractDualCurrency(grossProfit, sellingCost), taxFee);
  // A profit typed into the source file wins over the formula; show the gap instead of hiding it.
  const adjustment = subtractDualCurrency(summary.actual.profit, computedProfit);
  const hasAdjustment = Math.abs(adjustment.peso) >= 0.5;
  const profit = summary.actual.profit;
  const margin = shareOf(profit.peso, revenue.peso);
  const adsShareOfSelling = shareOf(ads.peso, sellingCost.peso);
  const perDay = (value: DualCurrencyAmount): DualCurrencyAmount =>
    days.length ? { peso: value.peso / days.length, vnd: value.vnd / days.length } : { peso: 0, vnd: 0 };
  const averageRevenue = perDay(revenue);
  const averageProfit = perDay(profit);

  const withCounts = days.filter((day) => day.refund.totalOrders != null && day.refund.refundedOrders != null);
  const orders =
    withCounts.length === days.length && days.length > 0
      ? {
          total: withCounts.reduce((acc, day) => acc + (day.refund.totalOrders ?? 0), 0),
          refunded: withCounts.reduce((acc, day) => acc + (day.refund.refundedOrders ?? 0), 0),
        }
      : null;
  // Refund rate = returned revenue / successful revenue. Without the month-to-date figures (a report restored from an older save)
  // the rate falls back to the orders of each day.
  const periodRefundRate = refundTrend
    ? refundRate(refundTrend.period.confirmed, refundTrend.period.returned)
    : orders && orders.total > 0
      ? (orders.refunded / orders.total) * 100
      : null;
  const pointOn = (date: string) => refundTrend?.daily.find((point) => point.date === date);
  // Every day of a month is shown with the same rate (10% on the 5th, 12% on the 6th: 12% for the whole month): the month-to-date one
  // of the "Lũy kế tháng" card, which the inventory provision uses too; the latest 7-day rate when the report has no such card.
  const monthRateOf = (day: ProcessedDailyFinance) => {
    const monthRate = monthToDateRate(refundTrend, day.date);
    if (monthRate !== null) return monthRate;
    const point = refundTrend ? latestOfMonth(refundTrend, day.date) : undefined;
    return point ? refundRate(point.confirmed, point.returned) : day.refund.rate;
  };

  // The last day against the day before it (for a report ending today: today against yesterday). The day before comes from the
  // range when it contains it, else from the separate read.
  const dayBefore = last ? addDays(last.date, -1) : null;
  const rangeDayBefore = days.find((day) => day.date === dayBefore);
  const lastStats: DayStats | null = last ? statsOfDay(last, pointOn(last.date)) : null;
  const previousStats: DayStats | null = rangeDayBefore
    ? statsOfDay(rangeDayBefore, pointOn(rangeDayBefore.date))
    : last && previousDay && previousDay.date === dayBefore
      ? withTrend(
          {
            date: previousDay.date,
            revenue: toDualCurrency(previousDay.revenue, last.exchangeRate),
            orders: previousDay.orders,
            refunded: previousDay.refunded,
            rate: previousDay.orders > 0 ? (previousDay.refunded / previousDay.orders) * 100 : null,
          },
          pointOn(previousDay.date),
        )
      : null;
  // The business-day tags are only worth a name for today and yesterday; any other day is shown by its date.
  const dayName = (date: string) => (date === localDate() ? "Hôm nay" : date === localDate(-1) ? "Hôm qua" : toDmy(date).slice(0, 5));
  const showDaily = days.length > 1;
  // Only usable when the series reaches the report's last day.
  const cumulativeView = refundTrend?.cumulative?.all.some((point) => point.date === last?.date) ? refundTrend.cumulative : undefined;

  return (
    <div ref={reportRef} className="report-capture min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Executive Financial Review · Philippines"
        title="Báo cáo quản trị tài chính Philippines"
        subtitle={`Bộ phận Sale Chatpage${mergedShops && mergedShops.length > 1 ? ` · Gộp ${mergedShops.length} shop: ${mergedShops.join(" + ")}` : ""} · Đơn vị quy đổi VNĐ (₫), peso (₱) trong ngoặc · ${describeRate(report)}`}
        metaLabel="Kỳ báo cáo"
        metaValue={period}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Tổng quan kỳ báo cáo" description="Doanh thu, chi phí và lợi nhuận của kỳ">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Doanh thu bán hàng" value={formatVnd(revenue.vnd)} helper={pesoNote(revenue)} />
            <StatCard
              label="Lợi nhuận"
              value={formatVnd(profit.vnd)}
              helper={`${pesoNote(profit)}${margin === null ? "" : ` · biên ${formatPercent(margin)}`}`}
              tone={getSignedValueTone(profit.peso)}
            />
            <StatCard label="Tổng chi phí bán hàng" value={formatVnd(sellingCost.vnd)} helper={`${pesoNote(sellingCost)} · chưa gồm giá vốn`} />
            <StatCard
              label="Tỷ lệ Ads / Doanh số"
              value={formatPercent(summary.adsRevenueRatio)}
              helper={adsShareOfSelling === null ? `Ads ${formatVnd(ads.vnd)}` : `Ads chiếm ${formatPercent(adsShareOfSelling)} chi phí bán hàng`}
            />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <StatCard
              label="Doanh thu trung bình mỗi ngày"
              value={formatVnd(averageRevenue.vnd)}
              helper={`${pesoNote(averageRevenue)} · ${days.length} ngày có số liệu`}
            />
            <StatCard
              label="Lợi nhuận trung bình mỗi ngày"
              value={formatVnd(averageProfit.vnd)}
              helper={pesoNote(averageProfit)}
              tone={getSignedValueTone(averageProfit.peso)}
            />
            <StatCard
              label="Tỷ lệ hoàn cả kỳ"
              value={formatPercent(periodRefundRate)}
              helper={
                orders
                  ? `Đơn hoàn / đơn đã xác nhận: ${countFormatter.format(orders.refunded)}/${countFormatter.format(orders.total)}`
                  : "Nguồn dữ liệu không có số đơn"
              }
            />
            <StatCard
              label="Dòng tiền ngày gần nhất"
              value={last ? formatVnd(last.cashflow.total.vnd) : "—"}
              helper={last ? `${pesoNote(last.cashflow.total)} · ${last.dateLabel}` : undefined}
            />
          </div>
        </ReportSection>

        <PhilippinesCharts report={report} dailyChart={!reconcile} />

        <div className="grid grid-cols-[1.8fr_1.2fr] items-start gap-8">
          <ReportSection index="02" title="Bóc tách chi phí và lợi nhuận" description="Số tiền VNĐ, peso trong ngoặc">
            <TableFrame>
              <Table className="text-xs">
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">STT</TableHead>
                    <TableHead>Chỉ tiêu</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <PnlRow no="1" label="Doanh số bán hàng" amount={revenue} strong />
                  <PnlRow no="2" label="Dự phòng rủi ro hàng tồn" amount={provision} tone="warn" />
                  <PnlRow no="3" label="Doanh thu thuần" amount={netRevenue} />
                  <PnlRow no="4" label="Giá vốn hàng bán" amount={cogs} />
                  <PnlRow no="5" label="Lợi nhuận gộp" amount={grossProfit} strong shaded />
                  <PnlRow no="6" label="Tổng chi phí bán hàng" amount={sellingCost} tone="cost" strong />
                  <PnlRow label="Chi phí Ads" amount={ads} level={1} badge={formatPercent(adsShareOfSelling)} />
                  <PnlRow label="Tỷ lệ Ads / Doanh số" text={formatPercent(summary.adsRevenueRatio)} level={2} />
                  <PnlRow label="Chi phí dịch vụ mua ngoài" amount={outsourced} level={1} badge={formatPercent(shareOf(outsourced.peso, sellingCost.peso))} />
                  <PnlRow label="Chi phí giao hàng" amount={shipping} level={1} badge={formatPercent(shareOf(shipping.peso, sellingCost.peso))} />
                  <PnlRow label="Chi phí lương" amount={payroll} level={1} badge={formatPercent(shareOf(payroll.peso, sellingCost.peso))} />
                  <PnlRow label="Chi phí khác" amount={other} level={1} badge={formatPercent(shareOf(other.peso, sellingCost.peso))} />
                  {hasTax ? <PnlRow no="7" label="Thuế, phí và lệ phí (chi phí quản lý)" amount={taxFee} tone="cost" strong /> : null}
                  {hasAdjustment ? (
                    <PnlRow no={hasTax ? "8" : "7"} label="Điều chỉnh theo lợi nhuận nhập sẵn trong file" amount={adjustment} signedValue />
                  ) : null}
                  <PnlRow no={String(7 + (hasTax ? 1 : 0) + (hasAdjustment ? 1 : 0))} label="Lợi nhuận" amount={profit} strong shaded profit />
                </TableBody>
              </Table>
            </TableFrame>
          </ReportSection>

          <div className="space-y-8">
            <ReportSection
              index="03"
              title={openOrders ? "Hiện trạng dòng tiền" : "Trạng thái dòng tiền"}
              description={openOrders ? `Tại thời điểm lấy dữ liệu, ${formatAsOf(openOrders.asOf)}` : last ? `Tại ngày ${last.dateLabel}` : undefined}
            >
              {last ? openOrders ? <OpenOrdersPanel openOrders={openOrders} day={last} /> : <CashflowPanel day={last} /> : null}
            </ReportSection>

            <ReportSection
              index="04"
              title="Doanh thu thành công và tỷ lệ hoàn"
              description={
                cumulativeView && last
                  ? `Cộng dồn đến ${dayName(last.date)} và ${dayName(addDays(last.date, -1))}`
                  : lastStats
                    ? `So sánh ${dayName(lastStats.date)} và ${previousStats ? dayName(previousStats.date) : "ngày trước"}`
                    : undefined
              }
            >
              {cumulativeView && last ? (
                <CumulativeRefundCards cumulative={cumulativeView} to={last.date} rate={last.exchangeRate} dayName={dayName} />
              ) : null}
              {!cumulativeView && lastStats ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <CompareCard title={dayName(lastStats.date)} stats={lastStats} />
                    {previousStats ? (
                      <CompareCard title={dayName(previousStats.date)} stats={previousStats} muted />
                    ) : (
                      <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                        Chưa có số của ngày trước. Bấm “Lấy dữ liệu” để cập nhật.
                      </div>
                    )}
                  </div>
                  {previousStats ? <CompareDelta current={lastStats} previous={previousStats} previousName={dayName(previousStats.date)} /> : null}
                </>
              ) : null}
              {!cumulativeView && days.length > 1 ? (
                <div className="mt-3">
                  <RefundPanel
                    title="Cả kỳ"
                    rows={[{ label: `${first?.dateLabel.slice(0, 5)} – ${last?.dateLabel.slice(0, 5)}`, revenue, rate: periodRefundRate }]}
                  />
                </div>
              ) : null}
              {cumulativeView && last ? (
                <CumulativeRefundAssessment cumulative={cumulativeView} to={last.date} />
              ) : (
                <RefundInsight days={days} orders={orders} trend={refundTrend} reportFrom={first?.date} />
              )}
            </ReportSection>
          </div>
        </div>

        {showDaily ? (
          <ReportSection
            index="05"
            title="Kết quả kinh doanh theo ngày"
            description="Giá vốn + Ads + Vận chuyển + Lương + Dịch vụ mua ngoài + Khác + Thuế/phí; kèm lợi nhuận lũy kế"
          >
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
                    <TableHead className="text-right">Dịch vụ, khác, thuế</TableHead>
                    <TableHead className="text-right">Tổng chi phí</TableHead>
                    <TableHead className="text-right">Lợi nhuận</TableHead>
                    <TableHead className="text-right">Biên LN</TableHead>
                    <TableHead className="text-right">LN lũy kế</TableHead>
                    <TableHead className="text-right">Ads / DT</TableHead>
                    <TableHead className="text-right">{cumulativeView ? "Tỷ lệ hoàn (lũy kế tháng)" : refundTrend ? "Tỷ lệ hoàn (lũy kế 7 ngày)" : "Tỷ lệ hoàn"}</TableHead>
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
                      <DualCell value={addDualCurrency(day.pnl.outsourcedServices, day.pnl.otherCost, day.pnl.taxFee)} />
                      <DualCell value={addDualCurrency(day.pnl.totalSalesCost, day.pnl.taxFee)} />
                      <DualCell value={day.pnl.netProfit} colored strong />
                      <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>
                        {formatPercent(shareOf(day.pnl.netProfit.peso, day.pnl.revenue.peso))}
                      </TableCell>
                      <DualCell value={day.cumulative.actual.profit} colored />
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{formatPercent(day.pnl.adsRevenueRatio)}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>{formatPercent(monthRateOf(day))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className={cn(cellClass, "font-semibold")}>Tổng</TableCell>
                    <DualCell value={revenue} strong />
                    <DualCell value={cogs} strong />
                    <DualCell value={ads} strong />
                    <DualCell value={shipping} strong />
                    <DualCell value={payroll} strong />
                    <DualCell value={addDualCurrency(outsourced, other, taxFee)} strong />
                    <DualCell value={addDualCurrency(summary.totalSalesCost, taxFee)} strong />
                    <DualCell value={profit} colored strong />
                    <TableCell className={cn(cellClass, "text-right font-semibold tabular-nums")}>{formatPercent(margin)}</TableCell>
                    <DualCell value={profit} colored strong />
                    <TableCell className={cn(cellClass, "text-right font-semibold tabular-nums")}>{formatPercent(summary.adsRevenueRatio)}</TableCell>
                    <TableCell className={cn(cellClass, "text-right font-semibold tabular-nums")}>{formatPercent(periodRefundRate)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </TableFrame>
          </ReportSection>
        ) : null}

        {reconcile ? (
          <CumulativeReconciliationSection
            index={showDaily ? "06" : "05"}
            shopId={reconcile.shopId}
            to={reconcile.to}
            currency="PHP"
            rate={last?.exchangeRate ?? report.defaultExchangeRate}
          />
        ) : null}

        <ReportFooter left={`Số liệu gốc bằng Peso (PHP), quy đổi VNĐ theo tỷ giá: ${describeRate(report)}`} right="Đơn vị tiền tệ: ₫ (₱ trong ngoặc)" />
      </div>
    </div>
  );
}

function signed(format: (value: number) => string, value: number) {
  return `${value > 0 ? "+" : ""}${format(value)}`;
}

function describeRefundDelta(delta: number) {
  return `${delta < 0 ? "giảm" : "tăng"} ${percentFormatter.format(Math.abs(delta))} điểm`;
}

/**
 * What the comparison shows for one day. With the 7-day figures `rate` is the cumulative refund rate of the 7 days up to that day and
 * `cumulative` carries the orders it was made of; otherwise `rate` is the day itself's own.
 */
type DayStats = {
  date: string;
  revenue: DualCurrencyAmount;
  orders: number | null;
  refunded: number | null;
  rate: number | null;
  cumulative?: { orders: number; refunded: number };
};

function withTrend(stats: DayStats, point: RefundPoint | undefined): DayStats {
  if (!point) return stats;
  return { ...stats, rate: refundRate(point.confirmed, point.returned), cumulative: { orders: point.orders, refunded: point.refunded } };
}

function statsOfDay(day: ProcessedDailyFinance, point: RefundPoint | undefined): DayStats {
  return withTrend(
    {
      date: day.date,
      revenue: day.comparison.actual.revenue,
      orders: day.refund.totalOrders ?? null,
      refunded: day.refund.refundedOrders ?? null,
      rate: day.refund.rate,
    },
    point,
  );
}

/** One day of the comparison: revenue, confirmed orders and how many of them were returned. */
function CompareCard({ title, stats, muted = false }: { title: string; stats: DayStats; muted?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", muted ? "bg-muted/30" : "bg-background")}>
      <p className="mb-2 border-b pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="font-normal normal-case">· {toDmy(stats.date).slice(0, 5)}</span>
      </p>
      <p className="text-[10px] uppercase text-muted-foreground">Doanh thu thành công</p>
      <p className="text-base font-semibold tabular-nums">{formatVnd(stats.revenue.vnd)}</p>
      <p className="text-[11px] text-muted-foreground">{pesoNote(stats.revenue)}</p>
      <div className="mt-2.5 flex items-end justify-between gap-3 border-t border-dashed pt-2.5">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Đơn xác nhận</p>
          <p className="text-sm font-semibold tabular-nums">{stats.orders === null ? "—" : countFormatter.format(stats.orders)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-muted-foreground">{stats.cumulative ? "Tỷ lệ hoàn lũy kế 7 ngày" : "Tỷ lệ hoàn"}</p>
          <p className="text-sm font-semibold tabular-nums">{formatPercent(stats.rate)}</p>
          {stats.cumulative ? (
            <p className="text-[11px] text-muted-foreground">
              {countFormatter.format(stats.cumulative.refunded)}/{countFormatter.format(stats.cumulative.orders)} đơn
            </p>
          ) : stats.refunded !== null && stats.orders !== null ? (
            <p className="text-[11px] text-muted-foreground">
              {countFormatter.format(stats.refunded)}/{countFormatter.format(stats.orders)} đơn
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** How the last day moved against the day before: revenue in per cent, the refund rate in points. Neither is judged good or bad. */
function CompareDelta({ current, previous, previousName }: { current: DayStats; previous: DayStats; previousName: string }) {
  const revenueChange = previous.revenue.peso === 0 ? null : ((current.revenue.peso - previous.revenue.peso) / previous.revenue.peso) * 100;
  const rateChange = current.rate !== null && previous.rate !== null ? current.rate - previous.rate : null;
  const arrow = (value: number) => (value > 0 ? "▲" : value < 0 ? "▼" : "▬");
  const name = previousName.toLowerCase();
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs">
      <p>
        <span className="text-muted-foreground">Doanh thu so với {name}: </span>
        <strong className="tabular-nums">
          {revenueChange === null ? "—" : `${arrow(revenueChange)} ${percentFormatter.format(Math.abs(revenueChange))}%`}
        </strong>
      </p>
      <p>
        <span className="text-muted-foreground">Tỷ lệ hoàn so với {name}: </span>
        <strong className="tabular-nums">{rateChange === null ? "—" : `${arrow(rateChange)} ${percentFormatter.format(Math.abs(rateChange))} điểm`}</strong>
      </p>
    </div>
  );
}

/** One row of the cost/profit statement: VND on top, peso in brackets underneath. */
function PnlRow({
  no,
  label,
  amount,
  text,
  level = 0,
  strong = false,
  shaded = false,
  profit = false,
  signedValue = false,
  tone,
  badge,
}: {
  no?: string;
  label: string;
  amount?: DualCurrencyAmount;
  text?: string;
  level?: 0 | 1 | 2;
  strong?: boolean;
  shaded?: boolean;
  profit?: boolean;
  signedValue?: boolean;
  tone?: "warn" | "cost";
  badge?: string;
}) {
  const toneClass = tone === "warn" ? "text-amber-700" : tone === "cost" ? "text-destructive" : undefined;
  return (
    <TableRow className={cn("break-inside-avoid hover:bg-transparent", shaded && "bg-muted/40")}>
      <TableCell className={cn(cellClass, "text-muted-foreground")}>{no}</TableCell>
      <TableCell className={cn(cellClass, level === 1 && "pl-8", level === 2 && "pl-12 text-muted-foreground", strong && "font-semibold", toneClass)}>
        {level === 1 ? "– " : level === 2 ? "+ " : ""}
        {label}
        {badge && badge !== "—" ? (
          <Badge variant="secondary" className="ml-2 h-auto px-1.5 py-0 text-[10px] tabular-nums">
            {badge}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className={cn(cellClass, "text-right tabular-nums")}>
        {amount ? (
          <>
            <span className={cn("block", strong && "font-semibold", profit ? signedTextClass(amount.peso) : toneClass)}>
              {signedValue ? signed(formatVnd, amount.vnd) : formatVnd(amount.vnd)}
            </span>
            <span className="block text-[11px] text-muted-foreground">{pesoNote(amount, signedValue)}</span>
          </>
        ) : (
          <span className="font-medium text-amber-700">{text}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function PanelRow({ label, children, muted = false }: { label: ReactNode; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dashed py-2.5 last:border-b-0 last:pb-0 first:pt-0">
      <span className={cn("text-xs font-medium", muted ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

function MoneyText({ value, strong = false }: { value: DualCurrencyAmount; strong?: boolean }) {
  return (
    <>
      <span className={cn("block text-sm", strong ? "font-semibold" : "font-medium")}>{formatVnd(value.vnd)}</span>
      <span className="block text-[11px] text-muted-foreground">{pesoNote(value)}</span>
    </>
  );
}

function formatAsOf(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

const OPEN_ORDER_ICONS: Record<string, { Icon: typeof CircleCheck; className: string }> = {
  "1": { Icon: CircleCheck, className: "text-emerald-500" },
  "9": { Icon: PackageOpen, className: "text-amber-500" },
  "2": { Icon: Truck, className: "text-sky-500" },
};

/**
 * The money in circulation right now: the COD of every order that is confirmed, waiting to be handed over or shipped, by status. It
 * is a balance of all open orders, not the figure of one day; the prepaid transfers of the last day stay as a note.
 */
function OpenOrdersPanel({ openOrders, day }: { openOrders: OpenOrders; day: ProcessedDailyFinance }) {
  const toDual = (value: number) => toDualCurrency(value, day.exchangeRate);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">1. Tiền đang luân chuyển</p>
        <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{formatVnd(toDual(openOrders.cod).vnd)}</p>
        <p className="text-[11px] text-muted-foreground">{pesoNote(toDual(openOrders.cod))}</p>
        <div className="mt-3 border-t pt-3">
          {openOrders.lines.map((line) => {
            const { Icon, className } = OPEN_ORDER_ICONS[line.status] ?? OPEN_ORDER_ICONS["1"];
            return (
              <PanelRow
                key={line.status}
                label={
                  <span className="flex items-center gap-2">
                    <Icon className={cn("size-3.5", className)} aria-hidden="true" />
                    {line.label}
                    <span className="font-normal text-muted-foreground">· {countFormatter.format(line.orders)} đơn</span>
                  </span>
                }
              >
                <MoneyText value={toDual(line.cod)} strong />
              </PanelRow>
            );
          })}
        </div>
      </div>
      <div className="rounded-lg border px-4 py-3">
        <PanelRow label={`Khách chuyển khoản trước ngày ${day.dateLabel}`} muted>
          <MoneyText value={day.cashflow.transfer} />
        </PanelRow>
      </div>
    </div>
  );
}

/** Where the money of the day is: COD still with the shipping partner, prepaid already received, and the two together. */
function CashflowPanel({ day }: { day: ProcessedDailyFinance }) {
  const { cashflow } = day;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-xs font-medium text-muted-foreground">Tiền đang luân chuyển (đơn đang giao, chưa thu COD)</p>
        <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{formatVnd(cashflow.moneyInTransit.vnd)}</p>
        <p className="text-[11px] text-muted-foreground">{pesoNote(cashflow.moneyInTransit)}</p>
      </div>
      <div className="rounded-lg border px-4 py-3">
        <PanelRow label="Khách chuyển khoản trước (đã nhận)" muted>
          <MoneyText value={cashflow.transfer} />
        </PanelRow>
        <PanelRow label="Tổng dòng tiền">
          <MoneyText value={cashflow.total} strong />
        </PanelRow>
      </div>
    </div>
  );
}

function RefundPanel({ title, rows }: { title: string; rows: { label: string; revenue: DualCurrencyAmount; rate: number | null }[] }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2.5 border-b pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {rows.length ? (
        rows.map((row, index) => (
          <PanelRow
            key={row.label}
            muted={index > 0}
            label={
              <>
                <span className="block text-[10px] uppercase text-muted-foreground">{row.label}</span>
                <span className="block text-sm font-semibold tabular-nums">{formatVnd(row.revenue.vnd)}</span>
                <span className="block text-[11px] font-normal text-muted-foreground">{pesoNote(row.revenue)}</span>
              </>
            }
          >
            <span className="block text-[10px] uppercase text-muted-foreground">Tỷ lệ hoàn</span>
            <span className="block text-sm font-semibold">{formatPercent(row.rate)}</span>
          </PanelRow>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">Chưa có dữ liệu</p>
      )}
    </div>
  );
}

/**
 * The refund-rate trend over the last days of the range. It is not coloured as good or bad: returns count against the day the
 * order was created, so the newest days always look better until their returns arrive.
 */
function RefundInsight({
  days,
  orders,
  trend,
  reportFrom,
}: {
  days: ProcessedDailyFinance[];
  orders: { total: number; refunded: number } | null;
  trend?: RefundTrend;
  /** First day of the report: the trend also holds earlier days of the month, which are not part of it. */
  reportFrom?: string;
}) {
  if (trend) return <CumulativeRefundInsight trend={trend} from={reportFrom} />;
  const recent = days.slice(-7).filter((day) => day.refund.rate !== null);
  const from = recent[0];
  const to = recent.at(-1);
  if (!from || !to || from === to) return null;
  const delta = (to.refund.rate as number) - (from.refund.rate as number);
  return (
    <div className="mt-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs leading-relaxed">
      <p>
        <strong>Diễn biến tỷ lệ hoàn ({recent.length} ngày gần nhất):</strong>{" "}
        {delta === 0
          ? `không đổi ở mức ${formatPercent(to.refund.rate)}`
          : `${describeRefundDelta(delta)}: ${formatPercent(from.refund.rate)} (${from.dateLabel.slice(0, 5)}) → ${formatPercent(to.refund.rate)} (${to.dateLabel.slice(0, 5)})`}
        .
      </p>
      {orders ? (
        <p className="mt-1 font-medium">
          Đơn hoàn / đơn đã xác nhận cả kỳ: {countFormatter.format(orders.refunded)}/{countFormatter.format(orders.total)}
        </p>
      ) : null}
    </div>
  );
}

/** The 7-day refund rate over the last days of the report, and the orders it is made of. */
function CumulativeRefundInsight({ trend, from }: { trend: RefundTrend; from?: string }) {
  const points = trend.daily.filter((point) => (!from || point.date >= from) && refundRate(point.confirmed, point.returned) !== null).slice(-7);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const rateOf = (point: RefundPoint) => refundRate(point.confirmed, point.returned) as number;
  const delta = rateOf(last) - rateOf(first);
  return (
    <div className="mt-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs leading-relaxed">
      <p>
        <strong>Diễn biến tỷ lệ hoàn lũy kế 7 ngày ({points.length} ngày gần nhất của báo cáo):</strong>{" "}
        {first === last
          ? `${formatPercent(rateOf(last))} (${toDmy(last.date).slice(0, 5)})`
          : delta === 0
            ? `không đổi ở mức ${formatPercent(rateOf(last))}`
            : `${describeRefundDelta(delta)}: ${formatPercent(rateOf(first))} (${toDmy(first.date).slice(0, 5)}) → ${formatPercent(rateOf(last))} (${toDmy(last.date).slice(0, 5)})`}
        .
      </p>
      <p className="mt-1 font-medium">
        Đơn hoàn / đơn đã xác nhận (7 ngày đến {toDmy(last.date).slice(0, 5)}): {countFormatter.format(last.refunded)}/{countFormatter.format(last.orders)}
      </p>
    </div>
  );
}

const rate2Formatter = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatRate2 = (value: number | null) => (value === null ? "—" : `${rate2Formatter.format(value)}%`);
const rateOfPoint = (point: CumulativePoint | undefined) => (point ? refundRate(point.confirmed, point.returned) : null);
/** Rates closer than this (in points) count as unchanged. */
const RATE_EPSILON = 0.005;

const TONES = {
  good: { card: "border-emerald-200 bg-emerald-50/60", title: "text-emerald-800", rate: "text-emerald-700" },
  bad: { card: "border-rose-200 bg-rose-50/60", title: "text-rose-800", rate: "text-rose-700" },
  flat: { card: "bg-muted/30", title: "text-muted-foreground", rate: "text-foreground" },
} as const;

/** A lower refund rate than the day before is good news, a higher one is bad. */
function toneOf(current: number | null, previous: number | null) {
  if (current === null || previous === null || Math.abs(current - previous) < RATE_EPSILON) return "flat" as const;
  return current < previous ? ("good" as const) : ("bad" as const);
}

/**
 * Section 04: the revenue and refund rate added up over the whole history of the shop and over the month to date, for the last day
 * and the day before it (the arrow is the change of the rate against that day).
 */
function CumulativeRefundCards({
  cumulative,
  to,
  rate,
  dayName,
}: {
  cumulative: RefundCumulative;
  to: string;
  rate: number;
  dayName: (date: string) => string;
}) {
  const before = addDays(to, -1);
  const at = (series: CumulativePoint[], date: string) => series.find((point) => point.date === date);
  const month = Number(to.slice(5, 7));
  // The day before the 1st belongs to the month before: its month total is not comparable.
  const sameMonth = before.slice(0, 7) === to.slice(0, 7);
  return (
    <div className="grid grid-cols-2 gap-3">
      <CumulativeCard
        title="Tổng cộng dồn"
        hint={`từ ${toDmy(cumulative.since)}${cumulative.legacy ? ` · gồm ${cumulative.legacy.label ?? "shop Phil cũ"}` : ""}`}
        rate={rate}
        rows={[
          { label: dayName(to), point: at(cumulative.all, to) },
          { label: dayName(before), point: at(cumulative.all, before) },
        ]}
      />
      <CumulativeCard
        title={`Lũy kế tháng ${month}`}
        hint={`từ 01/${String(month).padStart(2, "0")}${cumulative.monthBasis === "received" ? " · đơn đã nhận" : ""}`}
        rate={rate}
        rows={[
          { label: dayName(to), point: at(cumulative.month, to) },
          { label: dayName(before), point: sameMonth ? at(cumulative.month, before) : undefined },
        ]}
      />
    </div>
  );
}

function CumulativeCard({
  title,
  hint,
  rate,
  rows,
}: {
  title: string;
  hint: string;
  rate: number;
  rows: { label: string; point: CumulativePoint | undefined }[];
}) {
  const [current, previous] = rows;
  const currentRate = rateOfPoint(current.point);
  const previousRate = rateOfPoint(previous.point);
  const tone = TONES[toneOf(currentRate, previousRate)];
  return (
    <div className={cn("rounded-lg border p-3", tone.card)}>
      <p className={cn("mb-2 border-b pb-2 text-[11px] font-semibold uppercase tracking-wide", tone.title)}>
        {title} <span className="font-normal normal-case text-muted-foreground">· {hint}</span>
      </p>
      {rows.map((row, index) => {
        const value = row.point ? toDualCurrency(row.point.revenue, rate) : null;
        const rowRate = rateOfPoint(row.point);
        const change = index === 0 && currentRate !== null && previousRate !== null ? currentRate - previousRate : null;
        return (
          <div key={`${row.label}-${index}`} className={cn("flex items-end justify-between gap-3", index > 0 && "mt-2.5 border-t border-dashed pt-2.5")}>
            <div>
              <p className="text-[11px] text-muted-foreground">{row.label}</p>
              {value ? (
                <>
                  <p className={cn("tabular-nums", index === 0 ? "text-base font-semibold" : "text-sm font-medium text-muted-foreground")}>{formatVnd(value.vnd)}</p>
                  <p className="text-[11px] text-muted-foreground">{pesoNote(value)}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-muted-foreground">Tỷ lệ hoàn</p>
              <p className={cn("tabular-nums", index === 0 ? cn("text-base font-semibold", tone.rate) : "text-sm font-medium text-muted-foreground")}>
                {formatRate2(rowRate)}
                {change !== null && Math.abs(change) >= RATE_EPSILON ? <span aria-hidden="true"> {change < 0 ? "↓" : "↑"}</span> : null}
              </p>
              {row.point ? (
                <p className="text-[11px] text-muted-foreground">
                  {countFormatter.format(row.point.refunded)}/{countFormatter.format(row.point.orders)} đơn
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What the cumulative refund rate did over the last days (up to 7), and how many orders of the month came back. */
function CumulativeRefundAssessment({ cumulative, to }: { cumulative: RefundCumulative; to: string }) {
  const points = cumulative.all.filter((point) => point.date <= to && rateOfPoint(point) !== null).slice(-7);
  const first = points[0];
  const last = points.at(-1);
  const monthToDate = cumulative.month.find((point) => point.date === to);
  if (!first || !last) return null;
  const rateOf = (point: CumulativePoint) => rateOfPoint(point) as number;
  const delta = rateOf(last) - rateOf(first);
  const trend = Math.abs(delta) < RATE_EPSILON ? "ổn định" : delta < 0 ? "giảm" : "tăng";
  const steps = points.slice(1).map((point, index) => {
    const step = rateOf(point) - rateOf(points[index]);
    const verb = Math.abs(step) < RATE_EPSILON ? "giữ nguyên" : step < 0 ? "giảm xuống" : "tăng lên";
    return { date: point.date, text: `${verb} ${formatRate2(rateOf(point))}` };
  });
  const tone = trend === "giảm" ? TONES.good : trend === "tăng" ? TONES.bad : TONES.flat;
  return (
    <div className={cn("mt-3 rounded-lg border px-4 py-3 text-xs leading-relaxed", tone.card)}>
      <p>
        <strong>Đánh giá tỷ lệ hoàn cộng dồn ({points.length} ngày gần nhất):</strong>{" "}
        {points.length === 1
          ? `${formatRate2(rateOf(first))} (${toDmy(first.date).slice(0, 5)})`
          : `Có xu hướng ${trend} ${formatRate2(rateOf(first))} (${toDmy(first.date).slice(0, 5)}), ${steps
              .map((step) => `${step.text} (${toDmy(step.date).slice(0, 5)})`)
              .join(", ")}`}
        .
      </p>
      {monthToDate ? (
        <p className="mt-1 font-medium">
          Đơn hoàn/{cumulative.monthBasis === "received" ? "Đơn đã nhận" : "Đơn xác nhận"} (lũy kế tháng {Number(to.slice(5, 7))}): {countFormatter.format(monthToDate.refunded)}/{countFormatter.format(monthToDate.orders)}
        </p>
      ) : null}
    </div>
  );
}

/** One table cell showing a VND amount with its peso value in brackets underneath. */
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
        {signedValue ? signed(formatVnd, value.vnd) : formatVnd(value.vnd)}
      </span>
      <span className="block text-[11px] text-muted-foreground">{pesoNote(value, signedValue)}</span>
    </TableCell>
  );
}
