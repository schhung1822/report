"use client"

import { animate, stagger, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ChartIconTile } from "@/components/ui/chart-icon-tile"
import { ArrowUpRightIcon, CalendarSolidIcon, ChartBreakoutCircleIcon, ChevronDownIcon } from "@/components/ui/chart-icons"
import { ChartMenu, ChartMenuContent, ChartMenuRadioGroup, ChartMenuRadioItem, ChartMenuTrigger } from "@/components/ui/chart-menu"
import { ChartSwatch } from "@/components/ui/chart-swatch"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency, formatDay } from "@/lib/chart-format"
import { fittedDash, niceTicks, seededRandom } from "@/lib/chart-series"
import { cn } from "@/lib/utils"

type CashFlowDay = {
  /** The day, as an ISO date ("2026-05-06"). */
  date: string
  /** What came in that day. */
  moneyIn: number
  /** What went out that day. */
  moneyOut: number
}

/** Weekly: the last seven days. Monthly: the days of the latest month so far. Yearly: the months of the latest year so far. */
type CashFlowDailyPeriod = "all" | "weekly" | "monthly" | "yearly"

type CashFlowCurrency = {
  /** ISO 4217 code ("USD"): the button's label and the amounts' currency. */
  code: string
  /** A 16px glyph before the code (the sample gives USD Figma's flag). */
  flag?: React.ReactNode
  /** What one unit of the data's currency (the first in the list) is worth in this one. 1 by default. */
  rate?: number
}

/** One bar as the card shows it: a day (Weekly, Monthly) or a month (Yearly), in the shown currency. */
type CashFlowDailyBar = {
  /** The day, or the first day of the month, as an ISO date. */
  date: string
  unit: "day" | "month"
  moneyIn: number
  moneyOut: number
  /** Money in minus money out. */
  net: number
}

type CashFlowDailyBarChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  title?: string
  /** The glyph in the green tile (16px, white). */
  icon?: React.ReactNode
  /** The label over the period's net cash flow. */
  totalLabel?: string
  /** The label over the period's net cash flow per day. */
  averageLabel?: string
  /** The tooltip's names for the money in and the net (Vietnamese by default). */
  moneyInLabel?: string
  netLabel?: string
  /** One entry per day, oldest first. The periods are read from the latest day. */
  data?: CashFlowDay[]
  period?: CashFlowDailyPeriod
  defaultPeriod?: CashFlowDailyPeriod
  onPeriodChange?: (period: CashFlowDailyPeriod) => void
  /** The period menu's options and their labels (Weekly, Monthly, Yearly by default). */
  periods?: { value: CashFlowDailyPeriod; label: string }[]
  /** The currency menu. The data is in the first one; a single currency shows no menu. */
  currencies?: CashFlowCurrency[]
  /** The shown currency (a `code` from `currencies`). */
  currency?: string
  defaultCurrency?: string
  onCurrencyChange?: (currency: string) => void
  /** The y-axis values in the shown currency, lowest first. Four round values from zero by default. */
  ticks?: number[]
  /** The selected bar (an index into the period's bars), or null for none (the Figma card). */
  index?: number | null
  defaultIndex?: number | null
  onIndexChange?: (index: number | null, bar: CashFlowDailyBar | null) => void
  /** Text for a bar's day or month under the axis ("May 6", "Jan") and in the tooltip ("Wed, May 6", "January 2026"). */
  formatDate?: (date: string, context: "axis" | "tooltip", unit: "day" | "month") => string
  /** The button under the chart. */
  insightLabel?: string
  onInsightClick?: () => void
  locale?: string
}

type Shape = {
  x: number
  width: number
  /** The zero line, where every bar starts. */
  zero: number
  /** The top of the money-in bar. */
  top: number
  /** Where the net segment ends: above the zero line when positive, below it when negative. */
  end: number
}

// Figma geometry ("Cash Flow Daily Bar Chart" 1473:79483)
const PLOT_WIDTH = 754
const PLOT_HEIGHT = 176
const GRID_TOP = 16 // Figma's 1px grid lines cover [y - 1, y]: the top one ends at 16…
const GRID_BOTTOM = PLOT_HEIGHT - 4 // …the axis 4px above the bottom
const BASE = GRID_BOTTOM - 1 // the lowest tick's value sits on the axis' top edge (the bars stand on it)…
const SPAN = GRID_BOTTOM - GRID_TOP // …and the highest one 180px above it, on the top line's top edge
const TICK_COUNT = 4
const BAR_WIDTH = 32
const BAR_RATIO = 32 / 45 // a bar takes 32 of every 45px, and narrows when the bars come closer together
const BAR_RADIUS = 6
const BARS_END = 2 // the bars stop 2px short of the plot's right edge (752 of 754)
const TIP_GAP = 8 // between the active bar and the tooltip
const TIP_DROP = 6 // the tooltip's top is 6px under the bar's top
const TIP_PADDING_X = 24 // the tooltip's 12px side padding, twice
const TIP_PADDING_Y = 16 // and its 8px top and bottom padding
const LABEL_GAP = 8 // the least space between two x-axis labels
const LABEL_CHAR = 7.5 // about how wide a character of Label/02 is
const BARS_AT = 250
const BAR_STAGGER = 35
const NET_DELAY = 260 // the green segment rises this long after its bar
const GROW = 900
const MORPH = 750
const RIDE = 450
const DAY = 86_400_000
const RING = "focus-visible:ring-primary-green-500/40" // the card's focus rings are green
const BAR = '[data-slot="cash-flow-daily-bar-chart-bar"]'

const round = (n: number) => Math.round(n * 1000) / 1000
const round2 = (n: number) => Math.round(n * 100) / 100
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

/** `count` days from `start` whose income swings around $19K, keeping between -12% and 68% of it. */
function sampleDays(seed: number, start: string, count: number): CashFlowDay[] {
  const random = seededRandom(seed)
  let swing = 0
  return Array.from({ length: count }, (_, i) => {
    swing = swing * 0.9 + (random() - 0.5) * 0.24
    const moneyIn = round2(19000 * Math.exp(swing) * (0.62 + random() * 0.76))
    const kept = -0.12 + random() * 0.8
    return { date: addDays(start, i), moneyIn, moneyOut: round2(moneyIn * (1 - kept)) }
  })
}

// The Figma card: 1 to 17 May 2026 (the month so far). Each day's money in stands its grey bar as tall as Figma draws
// it on the $0–$30K axis the bars produce (6px per $1K), and money in minus money out its green segment.
const FIGMA_DAYS: [number, number][] = [
  [11000, 6000],
  [17500, 8833.33],
  [14000, 3833.33],
  [20166.67, 8500],
  [27166.67, 18833.34],
  [28166.67, 14500],
  [24666.67, 20500],
  [18166.67, 15833.34],
  [20166.67, 14666.67],
  [22833.33, 10500],
  [14000, 8833.33],
  [17500, 7833.33],
  [24666.67, 19833.34],
  [19166.67, 15833.34],
  [15666.67, 6166.67],
  [22833.33, 9166.66],
  [17500, 12666.67],
]
// January to April are generated (seeded), for the year.
const sampleCashFlowDays: CashFlowDay[] = [
  ...sampleDays(5, "2026-01-01", 120),
  ...FIGMA_DAYS.map(([moneyIn, moneyOut], i) => ({ date: addDays("2026-05-01", i), moneyIn, moneyOut })),
]

/** Figma "united states" (16px), drawn on Background/Disable. */
function UsFlag(props: React.ComponentProps<"svg">) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden data-slot="flag" {...props}>
      <circle cx="8" cy="8" r="8" className="fill-surface-disable" />
      <path d="M7.65234 7.99981H16.0002C16.0002 7.27775 15.9039 6.57825 15.7246 5.91284H7.65234V7.99981Z" fill="#d80027" />
      <path d="M7.65234 3.82598H14.826C14.3362 3.02686 13.7101 2.32051 12.98 1.73901H7.65234V3.82598Z" fill="#d80027" />
      <path d="M7.99941 15.9999C9.88219 15.9999 11.6127 15.3491 12.9793 14.2607H3.01953C4.38609 15.3491 6.11663 15.9999 7.99941 15.9999Z" fill="#d80027" />
      <path d="M1.17398 12.1739H14.8256C15.2188 11.5324 15.5237 10.8311 15.7242 10.0869H0.275391C0.475922 10.8311 0.780828 11.5324 1.17398 12.1739Z" fill="#d80027" />
      <path
        d="M3.70575 1.24931H4.43478L3.75666 1.74197L4.01569 2.53912L3.33759 2.04647L2.6595 2.53912L2.88325 1.85047C2.28619 2.34781 1.76287 2.9305 1.33162 3.57975H1.56522L1.13356 3.89334C1.06631 4.00553 1.00181 4.1195 0.94 4.23516L1.14612 4.86956L0.761563 4.59016C0.665969 4.79269 0.578531 4.99978 0.499938 5.21119L0.727031 5.91019H1.56522L0.887094 6.40284L1.14612 7.2L0.468031 6.70734L0.0618437 7.00247C0.0211875 7.32928 0 7.66216 0 8H8C8 3.58175 8 3.06087 8 0C6.41963 0 4.94641 0.458438 3.70575 1.24931ZM4.01569 7.2L3.33759 6.70734L2.6595 7.2L2.91853 6.40284L2.24041 5.91019H3.07859L3.33759 5.11303L3.59659 5.91019H4.43478L3.75666 6.40284L4.01569 7.2ZM3.75666 4.07241L4.01569 4.86956L3.33759 4.37691L2.6595 4.86956L2.91853 4.07241L2.24041 3.57975H3.07859L3.33759 2.78259L3.59659 3.57975H4.43478L3.75666 4.07241ZM6.88525 7.2L6.20716 6.70734L5.52906 7.2L5.78809 6.40284L5.10997 5.91019H5.94816L6.20716 5.11303L6.46616 5.91019H7.30434L6.62622 6.40284L6.88525 7.2ZM6.62622 4.07241L6.88525 4.86956L6.20716 4.37691L5.52906 4.86956L5.78809 4.07241L5.10997 3.57975H5.94816L6.20716 2.78259L6.46616 3.57975H7.30434L6.62622 4.07241ZM6.62622 1.74197L6.88525 2.53912L6.20716 2.04647L5.52906 2.53912L5.78809 1.74197L5.10997 1.24931H5.94816L6.20716 0.452156L6.46616 1.24931H7.30434L6.62622 1.74197Z"
        fill="#0052b4"
      />
    </svg>
  )
}

const sampleCashFlowCurrencies: CashFlowCurrency[] = [
  { code: "USD", flag: <UsFlag /> },
  { code: "EUR", rate: 0.86 },
  { code: "GBP", rate: 0.75 },
]

const defaultPeriods: { value: CashFlowDailyPeriod; label: string }[] = [
  { value: "all", label: "Cả kỳ" },
  { value: "weekly", label: "7 ngày cuối" },
  { value: "monthly", label: "Tháng gần nhất" },
  { value: "yearly", label: "Theo tháng" },
]

/** The bars of a period, in the shown currency, and how many days they cover (for the daily average). */
function periodBars(data: CashFlowDay[], period: CashFlowDailyPeriod, rate: number) {
  const bar = (date: string, unit: "day" | "month", moneyIn: number, moneyOut: number): CashFlowDailyBar => ({
    date,
    unit,
    moneyIn: moneyIn * rate,
    moneyOut: moneyOut * rate,
    net: (moneyIn - moneyOut) * rate,
  })
  const last = data[data.length - 1]?.date ?? ""
  if (period === "all") return { bars: data.map((day) => bar(day.date, "day", day.moneyIn, day.moneyOut)), days: data.length }
  if (period === "weekly") {
    const days = data.slice(-7)
    return { bars: days.map((day) => bar(day.date, "day", day.moneyIn, day.moneyOut)), days: days.length }
  }
  if (period === "monthly") {
    const days = data.filter((day) => day.date.slice(0, 7) === last.slice(0, 7))
    return { bars: days.map((day) => bar(day.date, "day", day.moneyIn, day.moneyOut)), days: days.length }
  }
  const months = new Map<string, { moneyIn: number; moneyOut: number }>()
  let days = 0
  for (const day of data) {
    if (day.date.slice(0, 4) !== last.slice(0, 4)) continue
    days++
    const month = `${day.date.slice(0, 7)}-01`
    const sum = months.get(month) ?? { moneyIn: 0, moneyOut: 0 }
    sum.moneyIn += day.moneyIn
    sum.moneyOut += day.moneyOut
    months.set(month, sum)
  }
  return { bars: [...months].map(([month, sum]) => bar(month, "month", sum.moneyIn, sum.moneyOut)), days }
}

/**
 * Where everything sits at a plot width. The y scale runs from the lowest tick on the axis (195) to the highest on the
 * top line (15); the bars stand on zero and are spread from the plot's left edge to 2px short of its right one, 32px
 * wide while there is room. A bar is as tall as its money in, its green segment as tall as its net (red and hanging
 * below zero when more went out than came in).
 */
function layoutChart(bars: CashFlowDailyBar[], ticksProp: number[] | undefined, width: number) {
  const min = Math.min(0, ...bars.map((bar) => bar.net))
  const max = Math.max(0, ...bars.map((bar) => Math.max(bar.moneyIn, bar.net)))
  const ticks = ticksProp?.length ? [...ticksProp].sort((a, b) => a - b) : niceTicks(min, max > min ? max : min + 1, TICK_COUNT)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const y = (value: number) => (hi > lo ? BASE - ((Math.min(Math.max(value, lo), hi) - lo) / (hi - lo)) * SPAN : BASE)
  const base = Math.min(Math.max(0, lo), hi)
  const zero = y(base)
  const n = bars.length
  const room = Math.max(0, width - BARS_END)
  const barWidth = round(n > 1 ? Math.min(BAR_WIDTH, (BAR_RATIO * room) / (n - 1 + BAR_RATIO)) : Math.min(BAR_WIDTH, room))
  const pitch = n > 1 ? (room - barWidth) / (n - 1) : room
  const shapes: Shape[] = bars.map((bar, i) => ({
    x: round(n > 1 ? i * pitch : (room - barWidth) / 2),
    width: barWidth,
    zero,
    top: Math.min(zero, y(Math.max(0, bar.moneyIn))),
    end: y(bar.net),
  }))
  // a 1px line over [y, y + 1] under each tick's value: dashed, the zero line solid
  const grid = ticks.map((tick) => ({ tick, y: y(tick) + 0.5, solid: tick === base }))
  return { ticks, shapes, barWidth, pitch, grid }
}

/** A bar from `top` to `bottom` with its far end round (the top for values above zero, the bottom below). */
function barPath(x: number, width: number, top: number, bottom: number, below = false) {
  const h = bottom - top
  if (h <= 0.01 || width <= 0) return `M ${round(x)} ${round(top)} Z`
  const r = round(Math.min(BAR_RADIUS, h, width / 2))
  const [l, rt, t, b] = [x, x + width, top, bottom].map(round)
  return below
    ? `M ${l} ${t} V ${round(b - r)} A ${r} ${r} 0 0 0 ${round(l + r)} ${b} H ${round(rt - r)} A ${r} ${r} 0 0 0 ${rt} ${round(b - r)} V ${t} Z`
    : `M ${l} ${b} V ${round(t + r)} A ${r} ${r} 0 0 1 ${round(l + r)} ${t} H ${round(rt - r)} A ${r} ${r} 0 0 1 ${rt} ${round(t + r)} V ${b} Z`
}

const inPath = (s: Shape) => barPath(s.x, s.width, s.top, s.zero)
const netPath = (s: Shape) => (s.end <= s.zero ? barPath(s.x, s.width, s.end, s.zero) : barPath(s.x, s.width, s.zero, s.end, true))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpShape = (a: Shape, b: Shape, t: number): Shape => ({
  x: lerp(a.x, b.x, t),
  width: lerp(a.width, b.width, t),
  zero: lerp(a.zero, b.zero, t),
  top: lerp(a.top, b.top, t),
  end: lerp(a.end, b.end, t),
})
/** The shape grown `inT` (money in) and `netT` (the net segment) of the way from the zero line. */
const grownShape = (s: Shape, inT: number, netT: number): Shape => ({ ...s, top: lerp(s.zero, s.top, inT), end: lerp(s.zero, s.end, netT) })

type TooltipText = { date: string; moneyIn: string; net: string; down: boolean }

/** The tooltip's lines. Rendered twice: visible (its amounts count) and as an invisible copy that is measured. */
function TooltipLines({
  text,
  labels,
  inRef,
  netRef,
}: {
  text: TooltipText
  labels: { moneyIn: string; net: string }
  inRef?: React.Ref<HTMLSpanElement>
  netRef?: React.Ref<HTMLSpanElement>
}) {
  return (
    <>
      <span className="typo-label-02-regular hug-w text-fg-soft">{text.date}</span>
      <span className="flex items-center gap-1.5">
        {/* Background/Subdued: the bars' Background/Base disappears in a swatch (as on Total Sales) */}
        <ChartSwatch className="h-5 w-1 bg-surface-subdued" />
        <span ref={inRef} className="typo-label-03-medium hug-w text-fg-loud">
          {text.moneyIn}
        </span>
        <span className="typo-label-02-regular hug-w text-fg-soft">{labels.moneyIn}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <ChartSwatch className={cn("h-5 w-1 transition-colors duration-200", text.down ? "bg-error-500" : "bg-primary-green-500")} />
        <span ref={netRef} className={cn("typo-label-03-medium hug-w transition-colors duration-200", text.down ? "text-error-500" : "text-primary-green-500")}>
          {text.net}
        </span>
        <span className="typo-label-02-regular hug-w text-fg-soft">{labels.net}</span>
      </span>
    </>
  )
}

/**
 * "Cash Flow Daily Bar Chart" from the Keitoto library: a green-tiled "Cash flow" card with a currency and a period
 * menu, the period's net cash flow and its daily average, and a bar per day on a dashed grid: grey as tall as the day's
 * money in, green up to what was left of it (money in minus money out; red below zero when more went out). Hover, tap or
 * the arrow keys pick a day: the other bars step back and a tooltip lists its amounts. The period menu shows the last
 * week, the month so far (the Figma card) or the year by month, the currency menu converts every amount. Animated with
 * anime.js: the tile pops, the totals count up, the grid draws across and the bars grow from the axis one after another
 * with their green rising inside; a new period or currency morphs the bars (new ones grow, gone ones sink) while the
 * totals count, and the tooltip slides from bar to bar.
 */
function CashFlowDailyBarChart({
  title = "Dòng tiền",
  icon = <ChartBreakoutCircleIcon />,
  totalLabel = "Tổng dòng tiền ròng",
  averageLabel = "Trung bình mỗi ngày",
  moneyInLabel = "Tiền vào",
  netLabel = "Dòng tiền ròng",
  data = sampleCashFlowDays,
  period: periodProp,
  defaultPeriod = "all",
  onPeriodChange,
  periods = defaultPeriods,
  currencies = sampleCashFlowCurrencies,
  currency: currencyProp,
  defaultCurrency,
  onCurrencyChange,
  ticks: ticksProp,
  index: indexProp,
  defaultIndex = null,
  onIndexChange,
  formatDate,
  insightLabel = "",
  onInsightClick,
  locale = "vi-VN",
  className,
  ...props
}: CashFlowDailyBarChartProps) {
  const [period, setPeriod] = useControllableState({ value: periodProp, defaultValue: defaultPeriod, onChange: onPeriodChange })
  const [currencyCode, setCurrency] = useControllableState({
    value: currencyProp,
    defaultValue: defaultCurrency ?? currencies[0]?.code ?? "USD",
    onChange: onCurrencyChange,
  })
  const currency = currencies.find((c) => c.code === currencyCode) ?? { code: currencyCode }
  const rate = currency.rate ?? 1
  const { bars, days } = React.useMemo(() => periodBars(data, period, rate), [data, period, rate])
  const n = bars.length
  const [indexValue, setIndex] = useControllableState<number | null>({
    value: indexProp,
    defaultValue: defaultIndex,
    onChange: (next) => onIndexChange?.(next, next === null ? null : (bars[next] ?? null)),
  })
  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const width = plot.width || PLOT_WIDTH
  const { ticks, shapes, barWidth, pitch, grid } = React.useMemo(() => layoutChart(bars, ticksProp, width), [bars, ticksProp, width])
  const keys = bars.map((bar) => `${bar.unit}:${bar.date}`)
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const shapeKey = shapes.map((s, i) => `${keys[i]}=${round(s.x)},${round(s.width)},${round(s.zero)},${round(s.top)},${round(s.end)}`).join(";")
  const ticksKey = ticks.join(";")
  const labelsKey = keys.join(";")

  const total = bars.reduce((sum, bar) => sum + bar.net, 0)
  const average = days ? total / days : 0

  // The hovered bar wins over the selected one; when the pointer leaves, the tooltip fades out where it was.
  const [hovered, setHovered] = React.useState<number | null>(null)
  const [held, setHeld] = React.useState(0)
  const selected = indexValue !== null && indexValue >= 0 && indexValue < n ? Math.round(indexValue) : null
  const active = hovered !== null && hovered < n ? hovered : selected
  const visible = active !== null
  const at = Math.max(0, Math.min(active ?? held, n - 1))
  const bar = bars[at]
  const shape = shapes[at]
  const hover = (i: number | null) => {
    setHovered(i)
    if (i !== null) setHeld(i)
  }
  const select = (i: number | null) => {
    setIndex(i)
    if (i !== null) setHeld(i)
  }

  const money = React.useCallback((value: number) => formatCurrency(value, { locale, currency: currency.code }), [locale, currency.code])
  const signedMoney = React.useCallback((value: number) => formatCurrency(value, { locale, currency: currency.code, signDisplay: "exceptZero" }), [locale, currency.code])
  const dateText = (date: string, context: "axis" | "tooltip", unit: "day" | "month") =>
    formatDate
      ? formatDate(date, context, unit)
      : formatDay(
          date,
          unit === "month"
            ? context === "axis"
              ? { month: "short" }
              : { month: "long", year: "numeric" }
            : context === "axis"
              ? { month: "short", day: "numeric" }
              : { weekday: "short", month: "short", day: "numeric" },
          locale,
        )
  const tipLabels = { moneyIn: moneyInLabel, net: netLabel }
  const tooltip: TooltipText | undefined = bar ? { date: dateText(bar.date, "tooltip", bar.unit), moneyIn: money(bar.moneyIn), net: signedMoney(bar.net), down: bar.net < 0 } : undefined

  // The tooltip sits right of the bar, or left of it when it would run past the plot, its top 6px under the bar's (kept
  // inside the plot). Its size is measured on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 160, height: 74 })
  const tipWidth = sizer.width + TIP_PADDING_X
  const tipHeight = sizer.height + TIP_PADDING_Y
  const flipped = shape ? shape.x + shape.width + TIP_GAP + tipWidth > width : false
  const tipLeft = shape ? Math.round(flipped ? Math.max(0, shape.x - TIP_GAP - tipWidth) : shape.x + shape.width + TIP_GAP) : 0
  const tipTop = shape ? Math.round(Math.min(Math.max(Math.min(shape.top, shape.end) + TIP_DROP, 0), Math.max(0, PLOT_HEIGHT - tipHeight))) : 0

  // The x axis names every bar, or every second (third…) one when they come too close for their labels.
  const labels = bars.map((b) => dateText(b.date, "axis", b.unit))
  const longest = Math.max(0, ...labels.map((label) => label.length))
  const every = n > 1 && pitch > 0 ? Math.max(1, Math.ceil((longest * LABEL_CHAR + LABEL_GAP) / pitch)) : 1

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const totalRef = React.useRef<HTMLParagraphElement>(null)
  const averageRef = React.useRef<HTMLParagraphElement>(null)
  const ghostsRef = React.useRef<SVGGElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const tipInRef = React.useRef<HTMLSpanElement>(null)
  const tipNetRef = React.useRef<HTMLSpanElement>(null)
  const totalText = money(total)
  const averageText = money(average)
  // what the entrance's callbacks need at play time (the card may be resized before it scrolls into view)
  const latest = React.useRef({ shapes, total, average, totalText, averageText })
  useIsomorphicLayoutEffect(() => {
    latest.current = { shapes, total, average, totalText, averageText }
  })
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])
  /** The two paths of each bar on screen (money in, net), by bar index. */
  const paths = () =>
    all(BAR).map((el) => ({
      moneyIn: el.querySelector<SVGPathElement>('[data-part="in"]'),
      net: el.querySelector<SVGPathElement>('[data-part="net"]'),
    }))
  const paint = (el: { moneyIn: SVGPathElement | null; net: SVGPathElement | null } | undefined, s: Shape | undefined) => {
    if (!el || !s) return
    el.moneyIn?.setAttribute("d", inPath(s))
    el.net?.setAttribute("d", netPath(s))
  }
  // How far the entrance has grown each bar (null without one), so a redraw before it is done (the card resized as its
  // font loads, new data) keeps the bars where the entrance has them.
  const growing = React.useRef<{ in: number; net: number }[] | null>(null)

  // New values count from the previous ones.
  useCountUp(totalRef, total, money, { duration: 900 })
  useCountUp(averageRef, average, money, { duration: 900 })
  useCountUp(tipInRef, bar?.moneyIn ?? 0, money, { duration: 400 })
  useCountUp(tipNetRef, bar?.net ?? 0, signedMoney, { duration: 400 })

  // Entrance, once the card is in view: the tile pops, the totals count up, the grid lines draw across and the labels
  // come in, then the bars grow from the axis one after another, each with its green rising inside it a moment later.
  useChartEntrance(root, (timeline) => {
    const totalEl = totalRef.current
    const averageEl = averageRef.current
    const els = paths()
    const growth = els.map(() => ({ in: 0, net: 0 }))
    growing.current = growth
    const grow = (i: number) => paint(els[i], latest.current.shapes[i] && grownShape(latest.current.shapes[i], growth[i].in, growth[i].net))
    els.forEach((_, i) => grow(i))
    const counter = { t: 0 }
    const count = () => {
      if (totalEl) totalEl.textContent = money(latest.current.total * counter.t)
      if (averageEl) averageEl.textContent = money(latest.current.average * counter.t)
    }
    count()
    timeline
      .add(all('[data-slot="chart-icon-tile"]'), { scale: { from: 0.6 }, opacity: { from: 0 }, duration: 700, ease: "outBack(1.8)" }, 0)
      .add(counter, { t: [0, 1], duration: 1400, ease: "outExpo", onUpdate: count }, 0)
      .add(all('[data-slot="cash-flow-daily-bar-chart-grid-line"]'), { x2: { from: 0 }, duration: 900, ease: "outQuad", delay: stagger(60) }, 100)
      .add(all('[data-slot="cash-flow-daily-bar-chart-tick"]'), { opacity: { from: 0 }, translateX: { from: -4 }, duration: 600, ease: "outQuad", delay: stagger(45) }, 200)
    const axisLabels = all('[data-slot="cash-flow-daily-bar-chart-axis-label"] > span')
    if (axisLabels.length) timeline.add(axisLabels, { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(35) }, 300)
    growth.forEach((state, i) => {
      timeline
        .add(state, { in: [0, 1], duration: GROW, ease: "outExpo", onUpdate: () => grow(i) }, BARS_AT + i * BAR_STAGGER)
        .add(state, { net: [0, 1], duration: GROW, ease: "outExpo", onUpdate: () => grow(i) }, BARS_AT + i * BAR_STAGGER + NET_DELAY)
    })
    return () => {
      if (growing.current === growth) growing.current = null
      growth.forEach((state, i) => {
        state.in = 1
        state.net = 1
        grow(i)
      })
      if (totalEl) totalEl.textContent = latest.current.totalText
      if (averageEl) averageEl.textContent = latest.current.averageText
    }
  })

  // A new period, currency or axis morphs the bars from the shapes they have on screen: a bar that stays (the same day
  // or month) moves and resizes, a new one grows from the zero line, one that is gone sinks into it. A resize redraws
  // them at once, unless it comes during a morph; while the entrance runs, they are redrawn as far as it has grown them.
  const shown = React.useRef<Map<string, Shape> | null>(null)
  const lastShape = React.useRef({ key: shapeKey, width })
  const morph = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastShape.current
    lastShape.current = { key: shapeKey, width }
    const target = new Map(keys.map((key, i) => [key, shapes[i]]))
    const from = shown.current ?? target
    shown.current = target
    if (before.key === shapeKey) return
    const els = paths()
    const ghosts = ghostsRef.current
    const morphing = !!morph.current
    morph.current?.cancel()
    morph.current = null
    ghosts?.replaceChildren()
    const entrance = growing.current
    if (entrance?.some((state) => state.in < 1 || state.net < 1)) {
      els.forEach((el, i) => paint(el, shapes[i] && grownShape(shapes[i], entrance[i]?.in ?? 1, entrance[i]?.net ?? 1)))
      return
    }
    if (reduced || (before.width !== width && !morphing)) {
      els.forEach((el, i) => paint(el, shapes[i]))
      return
    }
    // bars that are gone sink where they were, drawn into the ghost layer (React doesn't render them any more)
    const leaving = [...from].filter(([key]) => !target.has(key)).map(([, s]) => s)
    const ghostEls = leaving.map((s) => {
      const make = (part: string, className: string) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
        path.setAttribute("data-part", part)
        path.setAttribute("class", className)
        ghosts?.append(path)
        return path
      }
      return { moneyIn: make("in", "fill-surface-base"), net: make("net", s.end > s.zero ? "fill-error-500" : "fill-primary-green-500") }
    })
    const starts = keys.map((key, i) => from.get(key) ?? grownShape(shapes[i], 0, 0))
    const frame = (t: number) => {
      els.forEach((el, i) => paint(el, shapes[i] && lerpShape(starts[i], shapes[i], t)))
      ghostEls.forEach((el, i) => paint(el, grownShape(leaving[i], 1 - t, 1 - t)))
      shown.current = new Map(keys.map((key, i) => [key, lerpShape(starts[i], shapes[i], t)]))
    }
    const state = { t: 0 }
    frame(0)
    morph.current = animate(state, {
      t: 1,
      duration: MORPH,
      ease: "outExpo",
      onUpdate: () => frame(state.t),
      onComplete: () => {
        morph.current = null
        ghosts?.replaceChildren()
        shown.current = target
        els.forEach((el, i) => paint(el, shapes[i]))
      },
    })
  }, [shapeKey, reduced])
  React.useEffect(
    () => () => {
      morph.current?.cancel()
    },
    [],
  )

  // The tooltip pops in and fades out; moving to another bar slides it over (when it changes sides it pops in again).
  const lastTip = React.useRef({ visible, tipLeft, tipTop, flipped, width, labelsKey })
  useIsomorphicLayoutEffect(() => {
    const before = lastTip.current
    lastTip.current = { visible, tipLeft, tipTop, flipped, width, labelsKey }
    const tip = tipRef.current
    if (!tip || reduced) return
    if (before.visible !== visible) {
      if (visible) animate(tip, { opacity: [0, 1], scale: [0.94, 1], translateY: [6, 0], duration: 350, ease: "outBack(1.6)", onComplete: releaseStyles("opacity", "transform") })
      else animate(tip, { opacity: [1, 0], duration: 200, ease: "outQuad", onComplete: releaseStyles("opacity") })
      return
    }
    if (!visible || before.width !== width || before.labelsKey !== labelsKey) return
    if (before.flipped !== flipped) {
      animate(tip, { opacity: [0, 1], scale: [0.94, 1], duration: 300, ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
      return
    }
    if (before.tipLeft === tipLeft && before.tipTop === tipTop) return
    animate(tip, {
      translateX: [before.tipLeft - tipLeft + utils.get(tip, "translateX", false), 0],
      translateY: [before.tipTop - tipTop + utils.get(tip, "translateY", false), 0],
      duration: RIDE,
      ease: "outExpo",
      onComplete: releaseStyles("transform"),
    })
  }, [visible, tipLeft, tipTop, flipped, width, labelsKey, reduced])

  // New ticks or new bars fade their labels in again.
  const lastLabels = React.useRef({ ticksKey, labelsKey })
  useIsomorphicLayoutEffect(() => {
    const before = lastLabels.current
    lastLabels.current = { ticksKey, labelsKey }
    if (reduced) return
    const tickLabels = all('[data-slot="cash-flow-daily-bar-chart-tick"]')
    const axisLabels = all('[data-slot="cash-flow-daily-bar-chart-axis-label"] > span')
    if (before.ticksKey !== ticksKey && tickLabels.length)
      animate(tickLabels, { opacity: [0, 1], translateX: [-4, 0], duration: 450, delay: stagger(35), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
    if (before.labelsKey !== labelsKey && axisLabels.length)
      animate(axisLabels, { opacity: [0, 1], translateY: [4, 0], duration: 450, delay: stagger(25), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
  }, [ticksKey, labelsKey, reduced])

  const changePeriod = (next: string) => {
    const option = periods.find((p) => p.value === next)
    if (!option || option.value === period) return
    hover(null)
    select(null)
    setPeriod(option.value)
  }
  const onBarKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (event.key === "Escape") {
      if (selected === null) return
      event.preventDefault()
      select(null)
      return
    }
    const from = selected ?? i
    const next = { ArrowRight: from + 1, ArrowDown: from + 1, ArrowLeft: from - 1, ArrowUp: from - 1, Home: 0, End: n - 1 }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    const index = Math.min(Math.max(next, 0), n - 1)
    hover(null)
    select(index)
    root.current?.querySelectorAll<HTMLButtonElement>('[data-slot="cash-flow-daily-bar-chart-day"]')[index]?.focus()
  }

  const gridDash = fittedDash(width, 5, 5)
  const periodLabel = periods.find((p) => p.value === period)?.label ?? ""

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full", className)} {...props}>
      <div className="flex items-center justify-between gap-20">
        <div className="flex min-w-0 items-center gap-3">
          <ChartIconTile size={30} tone="green">{icon}</ChartIconTile>
          {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
          <p className="typo-heading-01-semibold -my-0.5 min-w-0 truncate py-0.5 text-fg-loud">{title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {currencies.length > 1 ? (
            <ChartMenu>
              <ChartMenuTrigger {...{ asChild: true }}>
                <ChartButton aria-label={`Tiền tệ: ${currency.code}`} className={cn("group/trigger text-fg-normal", RING)}>
                  {currency.flag}
                  {currency.code}
                  <ChevronDownIcon className="transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
                </ChartButton>
              </ChartMenuTrigger>
              <ChartMenuContent>
                <ChartMenuRadioGroup value={currency.code} onValueChange={setCurrency}>
                  {currencies.map((c) => (
                    <ChartMenuRadioItem key={c.code} value={c.code}>
                      <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                        {c.flag}
                        {c.code}
                      </span>
                    </ChartMenuRadioItem>
                  ))}
                </ChartMenuRadioGroup>
              </ChartMenuContent>
            </ChartMenu>
          ) : (
            <span className="flex h-9 shrink-0 items-center gap-1 px-2.5 typo-label-03-medium text-fg-normal [&_svg]:size-4">
              {currency.flag}
              <span className="hug-w px-0.5">{currency.code}</span>
            </span>
          )}
          <ChartMenu>
            <ChartMenuTrigger {...{ asChild: true }}>
              {/* Figma draws this calendar in Icon/Normal (the chevron stays Icon/Soft) */}
              <ChartButton aria-label={`Kỳ: ${periodLabel}`} className={cn("group/trigger text-fg-normal [&_svg:first-child]:text-icon-normal", RING)}>
                <CalendarSolidIcon />
                {periodLabel}
                <ChevronDownIcon className="transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
              </ChartButton>
            </ChartMenuTrigger>
            <ChartMenuContent>
              <ChartMenuRadioGroup value={period} onValueChange={changePeriod}>
                {periods.map((p) => (
                  <ChartMenuRadioItem key={p.value} value={p.value}>
                    {p.label}
                  </ChartMenuRadioItem>
                ))}
              </ChartMenuRadioGroup>
            </ChartMenuContent>
          </ChartMenu>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="typo-label-03-medium hug-w whitespace-nowrap text-fg-soft">{totalLabel}</p>
          <p ref={totalRef} data-slot="cash-flow-daily-bar-chart-total" className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
            {totalText}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="typo-label-03-medium hug-w whitespace-nowrap text-fg-soft">{averageLabel}</p>
          <p ref={averageRef} data-slot="cash-flow-daily-bar-chart-average" className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
            {averageText}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        {/* Figma "Y Axis Labels": 34px wide (wider labels widen it), spread from 8px down to the bottom, left-aligned */}
        <div aria-hidden className="hug-w flex min-w-[34px] shrink-0 flex-col justify-between pt-2" style={{ height: PLOT_HEIGHT }}>
          {[...ticks].reverse().map((tick) => (
            <span key={tick} data-slot="cash-flow-daily-bar-chart-tick" className="typo-label-02-regular whitespace-nowrap text-fg-soft">
              {formatCompactCurrency(tick, { locale, currency: currency.code })}
            </span>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div ref={plotRef} data-slot="cash-flow-daily-bar-chart-plot" className="relative" style={{ height: PLOT_HEIGHT }} onPointerLeave={() => hover(null)}>
            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
              {/* Figma "Grid Line": 1px Border/Soft over [y, y + 1] under each tick, dashed 5/5, the axis solid */}
              {grid.map((line) => (
                <line
                  key={line.tick}
                  data-slot="cash-flow-daily-bar-chart-grid-line"
                  x1={0}
                  x2={width}
                  y1={line.y}
                  y2={line.y}
                  className="stroke-border-soft"
                  {...(line.solid ? {} : gridDash)}
                />
              ))}
              {shapes.map((s, i) => (
                <g
                  key={keys[i]}
                  data-slot="cash-flow-daily-bar-chart-bar"
                  className={cn("transition-opacity duration-200", active !== null && i !== active && "opacity-40")}
                >
                  {/* Figma "Bar": Background/Base with 6px top corners, as tall as the money in */}
                  <path data-part="in" d={inPath(s)} className="fill-surface-base" />
                  {/* Figma "Bar Segment": Primary/Green/green-500 up to the net (Error/error-500 below zero) */}
                  <path data-part="net" d={netPath(s)} className={cn("transition-[fill] duration-300", bars[i].net < 0 ? "fill-error-500" : "fill-primary-green-500")} />
                </g>
              ))}
              <g ref={ghostsRef} />
            </svg>

            <div role="group" aria-label={title}>
              {bars.map((b, i) => {
                const center = shapes[i].x + barWidth / 2
                const left = n > 1 ? Math.max(0, center - pitch / 2) : 0
                const right = n > 1 ? Math.min(width, center + pitch / 2) : width
                return (
                  <button
                    key={keys[i]}
                    type="button"
                    data-slot="cash-flow-daily-bar-chart-day"
                    aria-label={`${dateText(b.date, "tooltip", b.unit)}: ${tipLabels.moneyIn.toLowerCase()} ${money(b.moneyIn)}, ${tipLabels.net.toLowerCase()} ${signedMoney(b.net)}`}
                    aria-pressed={i === selected}
                    tabIndex={i === (selected ?? 0) ? 0 : -1}
                    onPointerEnter={() => hover(i)}
                    onClick={() => select(i === selected ? null : i)}
                    onKeyDown={(event) => onBarKeyDown(event, i)}
                    className={cn("absolute inset-y-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2", RING)}
                    style={{ left, width: right - left }}
                  />
                )
              })}
            </div>

            {tooltip && (
              <div
                ref={tipRef}
                aria-hidden
                data-slot="cash-flow-daily-bar-chart-tooltip"
                className={cn(
                  "pointer-events-none absolute flex flex-col items-start gap-2 overflow-hidden rounded-xl bg-surface-white px-3 py-2 whitespace-nowrap",
                  // Figma paints later effects on top; CSS paints the first shadow on top
                  "shadow-[0_0_0_1px_#ececec,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                  !visible && "opacity-0",
                )}
                style={{ left: tipLeft, top: tipTop }}
              >
                <TooltipLines text={tooltip} labels={tipLabels} inRef={tipInRef} netRef={tipNetRef} />
              </div>
            )}
            {/* the same lines with their final text, measured to place the tooltip (the visible ones change width while they count) */}
            {tooltip && (
              <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col items-start gap-2 whitespace-nowrap">
                <TooltipLines text={tooltip} labels={tipLabels} />
              </span>
            )}
          </div>

          {/* each label centred under its bar */}
          <div aria-hidden className="relative h-3.5">
            {bars.map((b, i) =>
              i % every === 0 ? (
                <span key={keys[i]} data-slot="cash-flow-daily-bar-chart-axis-label" className="absolute top-0" style={{ left: shapes[i].x + barWidth / 2 }}>
                  <span className="typo-label-02-regular block -translate-x-1/2 whitespace-nowrap text-fg-soft">{labels[i]}</span>
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

      {insightLabel ? (
        <ChartButton onClick={onInsightClick} className={cn("self-start text-fg-normal", RING)}>
          {insightLabel}
          <ArrowUpRightIcon />
        </ChartButton>
      ) : null}
    </ChartCard>
  )
}

export {
  CashFlowDailyBarChart,
  sampleCashFlowCurrencies,
  sampleCashFlowDays,
  type CashFlowCurrency,
  type CashFlowDailyBar,
  type CashFlowDailyBarChartProps,
  type CashFlowDailyPeriod,
  type CashFlowDay,
}
