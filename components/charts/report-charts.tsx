"use client"

/**
 * Report-facing wrappers around the chart templates in /chart. Each takes plain report numbers, shapes them for its
 * template and renders nothing when there is nothing to draw (so a report never shows an empty card).
 */
import { CashFlowDailyBarChart, type CashFlowDay } from "@/chart/cash-flow-daily-bar-chart"
import { ExpensesChart, type ExpensesColor } from "@/chart/expenses-chart"
import { IncomeOverviewChart } from "@/chart/income-overview-chart"
import { PortfolioAllocationChart } from "@/chart/portfolio-allocation-chart"
import { RevenueByProductLineChart } from "@/chart/revenue-by-product-line-chart"
import { formatCompactCurrency } from "@/lib/chart-format"

const LOCALE = "vi-VN"
const OTHER = "Khác"

export type FlowDay = CashFlowDay

/** Days of money in against money out; the green part of each bar is what is left (red when it is negative). */
export function DailyFlowChart({
  title,
  days,
  currency,
  moneyInLabel,
  netLabel,
  totalLabel,
  averageLabel = "Trung bình mỗi ngày",
  className,
}: {
  title: string
  days: FlowDay[]
  currency: string
  moneyInLabel: string
  netLabel: string
  totalLabel: string
  averageLabel?: string
  className?: string
}) {
  const clean = days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date)).sort((a, b) => a.date.localeCompare(b.date))
  if (!clean.length || clean.every((day) => day.moneyIn === 0 && day.moneyOut === 0)) return null
  return (
    <CashFlowDailyBarChart
      className={className}
      title={title}
      data={clean}
      currencies={[{ code: currency }]}
      moneyInLabel={moneyInLabel}
      netLabel={netLabel}
      totalLabel={totalLabel}
      averageLabel={averageLabel}
      locale={LOCALE}
    />
  )
}

export type ShareItem = { key: string; label: string; value: number }

/** The biggest `maxSlices - 1` items, the rest gathered in one "Khác" slice. */
function topWithOther(items: ShareItem[], maxSlices: number) {
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value)
  if (positive.length <= maxSlices) return positive
  const head = positive.slice(0, maxSlices - 1)
  const rest = positive.slice(maxSlices - 1).reduce((sum, item) => sum + item.value, 0)
  return [...head, { key: "__other", label: OTHER, value: rest }]
}

/** A ring of shares (staff, channel, product): each slice's share of the total shows in the middle when it is chosen. */
export function ShareRingChart({
  title,
  description,
  items,
  currency,
  shareLabel,
  maxSlices = 5,
  className,
}: {
  title: string
  description?: string
  items: ShareItem[]
  currency: string
  /** What the share is of, after the percent ("tổng doanh thu"). */
  shareLabel: string
  maxSlices?: number
  className?: string
}) {
  const classes = topWithOther(items, maxSlices)
  if (!classes.length) return null
  return (
    <PortfolioAllocationChart
      className={className}
      title={title}
      description={description ?? ""}
      classes={classes}
      currency={currency}
      locale={LOCALE}
      formatShare={(share) => `${Math.round(share)}% ${shareLabel}`}
    />
  )
}

export type BarItem = { id: string; label: string; amount: number }

/** One bar per item (staff, day), each read against a mark; the biggest `maxRows` are drawn. */
export function RankedBarsChart({
  title,
  totalLabel,
  items,
  currency,
  target,
  targetLabel,
  maxRows = 6,
  className,
}: {
  title: string
  totalLabel: string
  items: BarItem[]
  currency: string
  /** The mark the bars are read against; the average of all items by default. */
  target?: number
  /** Names the mark in the line under the heading. */
  targetLabel?: string
  maxRows?: number
  className?: string
}) {
  const positive = items.map((item) => ({ ...item, amount: Math.max(0, item.amount) })).filter((item) => item.amount > 0)
  if (!positive.length) return null
  const total = positive.reduce((sum, item) => sum + item.amount, 0)
  const mark = target ?? total / positive.length
  const shown = [...positive].sort((a, b) => b.amount - a.amount).slice(0, maxRows)
  return (
    <IncomeOverviewChart
      className={className}
      title={title}
      totalLabel={totalLabel}
      total={total}
      change={null}
      breakdownTitle="Xếp hạng"
      breakdownDescription={`${targetLabel ?? "Mốc so sánh"}: ${formatCompactCurrency(mark, { locale: LOCALE, currency })}`}
      periods={shown}
      target={mark}
      currency={currency}
      locale={LOCALE}
    />
  )
}

const COST_COLORS: ExpensesColor[] = ["orange", "green", "yellow", "blue", "purple"]

export type CostPeriod = { value: string; label: string; values: Record<string, number> }

/** Where the money goes: a ring of cost categories, with an optional switch between periods (Dự tính / Thực tế). */
export function CostBreakdownChart({
  title,
  totalLabel,
  categories,
  periods,
  currency,
  className,
}: {
  title: string
  totalLabel: string
  categories: { id: string; label: string }[]
  periods: CostPeriod[]
  currency: string
  className?: string
}) {
  const usable = periods.filter((period) => Object.values(period.values).some((value) => value > 0))
  if (!usable.length || !categories.length) return null
  return (
    <ExpensesChart
      className={className}
      title={title}
      totalLabel={totalLabel}
      categories={categories.slice(0, COST_COLORS.length).map((category, i) => ({ ...category, color: COST_COLORS[i] }))}
      periods={usable.map((period) => ({ value: period.value, label: period.label, values: period.values }))}
      currency={currency}
      locale={LOCALE}
    />
  )
}

export type CompareLine = { label: string; first: number; second: number }

/** Two figures side by side for each group (Dự tính / Thực tế for Zalo and Page). */
export function PairedBarsChart({
  title,
  description,
  lines,
  firstLabel,
  secondLabel,
  currency,
  className,
}: {
  title: string
  description?: string
  lines: CompareLine[]
  firstLabel: string
  secondLabel: string
  currency: string
  className?: string
}) {
  const usable = lines.filter((line) => line.first > 0 || line.second > 0)
  if (!usable.length) return null
  const money = (value: number) => formatCompactCurrency(value, { locale: LOCALE, currency })
  return (
    <RevenueByProductLineChart
      className={className}
      title={title}
      description={description ?? ""}
      series={[
        { id: "first", label: firstLabel, color: "blue", tone: "solid" },
        { id: "second", label: secondLabel, color: "green", tone: "solid" },
      ]}
      data={usable.map((line) => ({ label: line.label, values: { first: line.first, second: line.second } }))}
      format={money}
      tickFormat={money}
      insight={(figure, change) => (
        <>
          {secondLabel} {change < 0 ? "cao hơn" : "thấp hơn"} {firstLabel.toLowerCase()} tới {figure} ở nhóm chênh lệch lớn nhất.
        </>
      )}
      locale={LOCALE}
    />
  )
}
