"use client"

/** The chart rows of each report, built from the report's own numbers (so Excel-fed reports get charts too). */
import {
  CostBreakdownChart,
  DailyFlowChart,
  PairedBarsChart,
  RankedBarsChart,
  ShareRingChart,
} from "@/components/charts/report-charts"
import { groupExpenses, type DailyReportData } from "@/lib/daily-report"
import type { DailyPerformanceRow, SharedPerformanceCosts } from "@/lib/performance-report"
import type { ChannelMetricsSet, ProcessedManagementReport } from "@/types/financial-management"
import type { ProcessedMonthlyFinanceReport } from "@/types/finance"

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const OTHER = "Khác"

// ------------------------------------------------------------------------------------------ performance (per staff)

export function PerformanceCharts({ dailyRows, sharedCosts }: { dailyRows: DailyPerformanceRow[]; sharedCosts?: SharedPerformanceCosts }) {
  if (!dailyRows.length) return null
  const cost = (pick: (row: DailyPerformanceRow) => number) => Math.max(0, sum(dailyRows.map(pick)))
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 items-stretch gap-4">
        <ShareRingChart
          title="Cơ cấu doanh thu theo nhân sự"
          description="Tỷ trọng đóng góp vào tổng doanh thu"
          items={dailyRows.map((row) => ({ key: row.name, label: row.name, value: row.revenue }))}
          currency="VND"
          shareLabel="tổng doanh thu"
        />
        <RankedBarsChart
          title="Doanh thu theo nhân sự"
          totalLabel="Tổng doanh thu"
          items={dailyRows.map((row) => ({ id: row.name, label: row.name, amount: row.revenue }))}
          currency="VND"
          targetLabel="Trung bình mỗi nhân sự"
        />
      </div>
      <CostBreakdownChart
        title="Cơ cấu chi phí"
        totalLabel="Tổng chi phí"
        currency="VND"
        categories={[
          { id: "cogs", label: "Giá vốn" },
          { id: "shipping", label: "Vận chuyển" },
          { id: "salary", label: "Lương" },
          { id: "fixed", label: "Định phí" },
          { id: "ads", label: "Quảng cáo" },
        ]}
        periods={[
          {
            value: "all",
            label: "Cả kỳ",
            values: {
              cogs: cost((row) => row.cogs),
              shipping: cost((row) => row.shipping),
              // The shop's own salary and fixed-cost totals belong to no staff member's row, so they are added here.
              salary: cost((row) => row.salary) + (sharedCosts?.salary ?? 0),
              fixed: cost((row) => row.fixedCost) + (sharedCosts?.fixedCost ?? 0),
              ads: cost((row) => row.ads),
            },
          },
        ]}
      />
    </section>
  )
}

// ------------------------------------------------------------------------------------------ daily report (VN)

export function DailyReportCharts({ data }: { data: DailyReportData }) {
  const series = data.series ?? []
  const groups = groupExpenses(data.expenses)
    .map((group) => ({ id: group.payer, label: group.payer, total: group.total }))
    .sort((a, b) => b.total - a.total)
  // at most 5 categories: the rest of the payers are gathered
  const shown = groups.length > 5 ? [...groups.slice(0, 4), { id: "__other", label: OTHER, total: sum(groups.slice(4).map((g) => g.total)) }] : groups

  if (series.length < 2 && shown.length < 2) return null
  return (
    <section className="space-y-4">
      {series.length >= 2 ? (
        <DailyFlowChart
          title="Doanh số theo ngày"
          days={series}
          currency="VND"
          moneyInLabel="Doanh số"
          netLabel="Sau phí vận chuyển"
          totalLabel="Tổng sau phí vận chuyển"
        />
      ) : null}
      {shown.length >= 2 ? (
        <CostBreakdownChart
          title="Chi xuất quỹ theo người chi"
          totalLabel="Tổng chi nhà cung cấp"
          currency="VND"
          categories={shown.map((group) => ({ id: group.id, label: group.label }))}
          periods={[{ value: "all", label: "Trong kỳ", values: Object.fromEntries(shown.map((group) => [group.id, group.total])) }]}
        />
      ) : null}
    </section>
  )
}

// ------------------------------------------------------------------------------------------ management (VN, Zalo / Page)

/**
 * `zalo` draws the Zalo channel only; `total` draws both channels together, with a Zalo-versus-Page revenue chart unless
 * `splitByChannel` is false (a report that treats the shop as one). `label` names the scope in the titles.
 */
export function ManagementCharts({
  report,
  channel,
  label: customLabel,
  splitByChannel = channel === "total",
  dailyChart = true,
  compareEstimated = true,
}: {
  report: ProcessedManagementReport
  channel: "zalo" | "total"
  label?: string
  splitByChannel?: boolean
  /** False when the daily revenue chart is drawn elsewhere (the cumulative reconciliation, which shows many days). */
  dailyChart?: boolean
  /** False draws the costs of the period once instead of "Dự tính" next to "Thực tế". */
  compareEstimated?: boolean
}) {
  const pick = (set: ChannelMetricsSet) => (channel === "zalo" ? set.zalo : set.total)
  const { summary, days } = report
  const estimated = pick(summary.estimated)
  const actual = pick(summary.actual)
  const label = customLabel ?? (channel === "zalo" ? "kênh Zalo" : "Zalo + Page")

  return (
    <section className="space-y-4">
      {dailyChart ? (
        <DailyFlowChart
          title={`Doanh thu và chi phí theo ngày · ${label}`}
          days={days.map((day) => {
            const metrics = pick(day.actual)
            return { date: day.date, moneyIn: metrics.revenue, moneyOut: metrics.revenue - metrics.profit }
          })}
          currency="VND"
          moneyInLabel={compareEstimated ? "Doanh thu thực tế" : "Doanh thu"}
          netLabel="Lợi nhuận"
          totalLabel={compareEstimated ? "Tổng lợi nhuận thực tế" : "Tổng lợi nhuận"}
        />
      ) : null}
      <div className={splitByChannel ? "grid grid-cols-2 items-stretch gap-4" : undefined}>
        <CostBreakdownChart
          title={`Cơ cấu chi phí · ${label}`}
          totalLabel="Tổng chi phí"
          currency="VND"
          categories={[
            { id: "cogs", label: "Giá vốn" },
            { id: "salary", label: "Lương" },
            { id: "ads", label: "Marketing" },
            { id: "fixed", label: "Định phí" },
          ]}
          periods={
            compareEstimated
              ? [
                  { value: "estimated", label: "Dự tính", values: costValues(estimated) },
                  { value: "actual", label: "Thực tế", values: costValues(actual) },
                ]
              : [{ value: "all", label: "Cả kỳ", values: costValues(actual) }]
          }
        />
        {splitByChannel ? (
          <PairedBarsChart
            title="Doanh thu theo kênh"
            description="Dự tính so với thực tế của từng kênh"
            firstLabel="Dự tính"
            secondLabel="Thực tế"
            currency="VND"
            lines={[
              { label: "Zalo", first: summary.estimated.zalo.revenue, second: summary.actual.zalo.revenue },
              { label: "Page", first: summary.estimated.page.revenue, second: summary.actual.page.revenue },
            ]}
          />
        ) : null}
      </div>
    </section>
  )
}

function costValues(metrics: { totalCogs: number; totalSalary: number; adsCost: number; totalFixedCosts: number }) {
  return {
    cogs: Math.max(0, metrics.totalCogs),
    salary: Math.max(0, metrics.totalSalary),
    ads: Math.max(0, metrics.adsCost),
    fixed: Math.max(0, metrics.totalFixedCosts),
  }
}

// ------------------------------------------------------------------------------------------ Philippines (shown in VND)

/** The Philippines report is read in dong: every figure is the day's peso amount converted at that day's rate. */
export function PhilippinesCharts({ report, dailyChart = true }: { report: ProcessedMonthlyFinanceReport; dailyChart?: boolean }) {
  const { days } = report
  if (!days.length) return null
  const total = (pick: (day: (typeof days)[number]) => number) => Math.max(0, sum(days.map(pick)))
  return (
    <section className="space-y-4">
      {dailyChart ? (
        <DailyFlowChart
          title="Doanh thu và lợi nhuận theo ngày"
          days={days.map((day) => ({
            date: day.date,
            moneyIn: day.comparison.actual.revenue.vnd,
            moneyOut: day.comparison.actual.revenue.vnd - day.pnl.netProfit.vnd,
          }))}
          currency="VND"
          moneyInLabel="Doanh thu"
          netLabel="Lợi nhuận"
          totalLabel="Tổng lợi nhuận"
        />
      ) : null}
      <CostBreakdownChart
        title="Cơ cấu chi phí bán hàng"
        totalLabel="Tổng chi phí"
        currency="VND"
        categories={[
          { id: "cogs", label: "Giá vốn" },
          { id: "ads", label: "Quảng cáo" },
          { id: "shipping", label: "Vận chuyển" },
          { id: "payroll", label: "Lương" },
          { id: "other", label: "Dịch vụ, khác, thuế" },
        ]}
        periods={[
          {
            value: "all",
            label: "Cả kỳ",
            values: {
              cogs: total((day) => day.pnl.cogs.vnd),
              ads: total((day) => day.pnl.ads.vnd),
              shipping: total((day) => day.pnl.shippingFees.vnd),
              payroll: total((day) => day.pnl.payroll.vnd),
              other: total((day) => day.pnl.outsourcedServices.vnd + day.pnl.otherCost.vnd + day.pnl.taxFee.vnd),
            },
          },
        ]}
      />
    </section>
  )
}
