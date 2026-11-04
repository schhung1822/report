import type { ReactNode, Ref } from "react";
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
import { PhilippinesCharts } from "@/components/charts/report-chart-blocks";
import { CumulativeReconciliationSection } from "@/components/reports/cumulative-reconciliation";
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
import type { DualCurrencyAmount, ProcessedDailyFinance, ProcessedMonthlyFinanceReport, RefundPerformance } from "@/types/finance";
import { addDualCurrency, formatPeso, formatVnd, getSignedValueTone, subtractDualCurrency } from "@/utils/finance";

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
}: {
  report: ProcessedMonthlyFinanceReport;
  reportRef?: Ref<HTMLDivElement>;
  /** The Pancake shop and the report's last day: when given, the cumulative reconciliation is shown at the bottom. */
  reconcile?: { shopId: number; to: string };
}) {
  const { summary, days } = report;
  const first = days[0];
  const last = days.at(-1);
  const previous = days.length > 1 ? days[days.length - 2] : undefined;
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
  const orders = withCounts.length === days.length && days.length > 0
    ? {
        total: withCounts.reduce((acc, day) => acc + (day.refund.totalOrders ?? 0), 0),
        refunded: withCounts.reduce((acc, day) => acc + (day.refund.refundedOrders ?? 0), 0),
      }
    : null;
  const periodRefundRate = orders && orders.total > 0 ? (orders.refunded / orders.total) * 100 : null;

  return (
    <div ref={reportRef} className="report-capture min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Executive Financial Review · Philippines"
        title="Báo cáo quản trị tài chính Philippines"
        subtitle={`Bộ phận Sale Chatpage · Đơn vị quy đổi VNĐ (₫), peso (₱) trong ngoặc · ${describeRate(report)}`}
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
            <StatCard
              label="Tổng chi phí bán hàng"
              value={formatVnd(sellingCost.vnd)}
              helper={`${pesoNote(sellingCost)} · chưa gồm giá vốn`}
            />
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
              helper={orders ? `Đơn hoàn / đơn đã xác nhận: ${countFormatter.format(orders.refunded)}/${countFormatter.format(orders.total)}` : "Nguồn dữ liệu không có số đơn"}
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
                  {hasAdjustment ? <PnlRow no={hasTax ? "8" : "7"} label="Điều chỉnh theo lợi nhuận nhập sẵn trong file" amount={adjustment} signedValue /> : null}
                  <PnlRow no={String(7 + (hasTax ? 1 : 0) + (hasAdjustment ? 1 : 0))} label="Lợi nhuận" amount={profit} strong shaded profit />
                </TableBody>
              </Table>
            </TableFrame>
          </ReportSection>

          <div className="space-y-8">
            <ReportSection index="03" title="Trạng thái dòng tiền" description={last ? `Tại ngày ${last.dateLabel}` : undefined}>
              {last ? <CashflowPanel day={last} /> : null}
            </ReportSection>

            <ReportSection index="04" title="Doanh thu thành công và tỷ lệ hoàn">
              <div className="grid grid-cols-2 gap-3">
                <RefundPanel
                  title="Cả kỳ"
                  rows={[
                    {
                      label: days.length > 1 ? `${first?.dateLabel.slice(0, 5)} – ${last?.dateLabel.slice(0, 5)}` : (last?.dateLabel ?? "—"),
                      revenue,
                      rate: periodRefundRate,
                    },
                  ]}
                />
                <RefundPanel
                  title="Ngày gần nhất"
                  rows={[
                    ...(last ? [{ label: last.dateLabel.slice(0, 5), revenue: last.comparison.actual.revenue, rate: last.refund.rate }] : []),
                    ...(previous ? [{ label: previous.dateLabel.slice(0, 5), revenue: previous.comparison.actual.revenue, rate: previous.refund.rate }] : []),
                  ]}
                />
              </div>
              <RefundInsight days={days} orders={orders} />
            </ReportSection>
          </div>
        </div>

        <ReportSection index="05" title="Kết quả kinh doanh theo ngày" description="Giá vốn + Ads + Vận chuyển + Lương + Dịch vụ mua ngoài + Khác + Thuế/phí; kèm lợi nhuận lũy kế">
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
                    <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>{formatPercent(shareOf(day.pnl.netProfit.peso, day.pnl.revenue.peso))}</TableCell>
                    <DualCell value={day.cumulative.actual.profit} colored />
                    <TableCell className={cn(cellClass, "text-right tabular-nums")}>{formatPercent(day.pnl.adsRevenueRatio)}</TableCell>
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
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="06" title="Dòng tiền và tỷ lệ hoàn theo ngày" description="Tỷ lệ hoàn giảm so với ngày trước là tín hiệu tốt">
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
                  <TableHead className="text-right">Đơn hoàn / đã xác nhận</TableHead>
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
                    <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>
                      {day.refund.totalOrders != null && day.refund.refundedOrders != null
                        ? `${countFormatter.format(day.refund.refundedOrders)}/${countFormatter.format(day.refund.totalOrders)}`
                        : "—"}
                    </TableCell>
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

        {reconcile ? (
          <CumulativeReconciliationSection
            index="07"
            shopId={reconcile.shopId}
            to={reconcile.to}
            currency="PHP"
            rate={last?.exchangeRate ?? report.defaultExchangeRate}
          />
        ) : null}

        <ReportFooter
          left={`Số liệu gốc bằng Peso (PHP), quy đổi VNĐ theo tỷ giá: ${describeRate(report)}`}
          right="Đơn vị tiền tệ: ₫ (₱ trong ngoặc)"
        />
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

function CashflowPanel({ day }: { day: ProcessedDailyFinance }) {
  const { cashflow } = day;
  const unverified = cashflow.unverifiedMoney;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-xs font-medium text-muted-foreground">Tiền đang luân chuyển (đơn đang giao, chưa thu COD)</p>
        <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{formatVnd(cashflow.moneyInTransit.vnd)}</p>
        <p className="text-[11px] text-muted-foreground">{pesoNote(cashflow.moneyInTransit)}</p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <p className="text-xs font-medium text-amber-800">Tiền chưa đối soát</p>
        <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight text-amber-800">{formatVnd(unverified.vnd)}</p>
        <p className="mb-2 text-[11px] text-amber-700">{pesoNote(unverified)}</p>
        <PanelRow label="– POS" muted>
          <MoneyText value={cashflow.pos} />
        </PanelRow>
        <PanelRow label="– Chuyển khoản" muted>
          <MoneyText value={cashflow.transfer} />
        </PanelRow>
      </div>
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <span className="text-xs font-medium">Tổng dòng tiền</span>
        <span className="text-right tabular-nums">
          <MoneyText value={cashflow.total} strong />
        </span>
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

/** The refund-rate trend over the last days of the range, green when it is falling (less returns is good news). */
function RefundInsight({ days, orders }: { days: ProcessedDailyFinance[]; orders: { total: number; refunded: number } | null }) {
  const recent = days.slice(-7).filter((day) => day.refund.rate !== null);
  const from = recent[0];
  const to = recent.at(-1);
  if (!from || !to || from === to) return null;
  const delta = (to.refund.rate as number) - (from.refund.rate as number);
  const rising = delta > 0;
  return (
    <div
      className={cn(
        "mt-3 rounded-lg border px-4 py-3 text-xs leading-relaxed",
        rising ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      <p>
        <strong>Đánh giá tỷ lệ hoàn ({recent.length} ngày gần nhất):</strong>{" "}
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
