"use client"

import { animate, stagger, utils } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ArrowCircleDownIcon, ArrowCircleUpIcon, ArrowUpRightIcon, InfoCircleLineIcon, LineChartUpIcon } from "@/components/ui/chart-icons"
import { ChartLegendDot } from "@/components/ui/chart-legend-dot"
import { ChartSwatch } from "@/components/ui/chart-swatch"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatPercent } from "@/lib/chart-format"
import { fittedDash, niceTicks } from "@/lib/chart-series"
import { cn } from "@/lib/utils"

type RevenueProductLineColor = "blue" | "purple" | "green" | "orange"

/** One bar of every product line: what it measures and how it looks. */
type RevenueProductLineSeries = {
  id: string
  /** The legend's and the tooltip's label ("Industry Avg. churn"). */
  label: string
  /** The hue (blue in Figma). */
  color?: RevenueProductLineColor
  /** "solid" (the 400–600 steps, a semibold value) or "soft" (50–200, a medium one). The first series is solid, the others soft by default. */
  tone?: "solid" | "soft"
}

/** A product line: its label under the axis and a churn rate in percent per series id (a missing one is 0). */
type RevenueProductLine = {
  label: string
  values: Record<string, number>
}

type RevenueByProductLineChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  title?: string
  /** The soft line under the title. */
  description?: string
  /** The data source named in the header ("Stripe"); leave it empty for none. */
  dataSource?: string
  /** Where the data source links to (a link when set). */
  dataSourceHref?: string
  /** Called by the ⓘ button after the data source. */
  onInfoClick?: () => void
  /** The label over the plot. */
  label?: string
  /** The bars of each product line, left to right. The first is the benchmark the second is compared with. */
  series?: RevenueProductLineSeries[]
  data?: RevenueProductLine[]
  /** The y-axis values in percent, lowest first. Six round values from 0% by default. */
  ticks?: number[]
  /** Ids of the series turned off in the legend. */
  hiddenSeries?: string[]
  defaultHiddenSeries?: string[]
  onHiddenSeriesChange?: (hidden: string[]) => void
  /** The selected product line (an index into `data`), or null for none (the Figma card). */
  index?: number | null
  defaultIndex?: number | null
  onIndexChange?: (index: number | null, line: RevenueProductLine | null) => void
  /**
   * The sentence under the chart around the highlighted figure: the largest drop from the first series to the second,
   * in percent of the first (below zero when the second is higher).
   */
  insight?: (figure: React.ReactNode, change: number) => React.ReactNode
  /** The text next to the arrow button; without it the button is left out. */
  actionLabel?: string
  /** Formats a bar's value and the axis' values; percent by default (Vietnamese reports pass a money formatter). */
  format?: (value: number) => string
  tickFormat?: (value: number) => string
  /** Called by the arrow button. */
  onActionClick?: () => void
  locale?: string
}

// Figma geometry ("Revenue by Product Line Chart" 1473:88633)
const PLOT_WIDTH = 600
const PLOT_HEIGHT = 250
const BASE = PLOT_HEIGHT - 1 // the bars stand on the axis (its 1px line covers [359, 360])…
const SPAN = PLOT_HEIGHT - 8 // …and the highest tick's value is 8px under the plot's top, on the top grid line's top edge (over [7, 8])
const TICK_COUNT = 5
const BAR_WIDTH = 48 // at most; narrower when the product lines don't fit
const BAR_GAP = 10 // between the bars of a product line
const INSET_LEFT = 43 // Figma's bar row runs from 43px in to 46px short of the plot's right edge, the lines spread across it
const INSET_RIGHT = 46
const GROUP_GAP = 24 // the least space between two product lines' bars
const VALUE_GAP = 8 // between a bar and its value
const VALUE_MIN_BAR = 36 // narrower bars leave their values to the tooltip (side by side they would run into each other)
const TIP_GAP = 8 // between the product line's bars and the tooltip
const TIP_DROP = 6 // the tooltip's top is 6px under the taller bar's top
const TIP_PADDING_X = 24 // the tooltip's 12px side padding, twice
const TIP_PADDING_Y = 16 // and its 8px top and bottom padding
const BARS_AT = 250
const LINE_STAGGER = 90
const BAR_STAGGER = 60
const GROW = 1100
const MORPH = 650
const NONE: string[] = []

// A bar: the hue's gradient top to bottom (sRGB like Figma), a 1px ring of its colour, a soft drop shadow, a white inner
// glow and a white inside stroke fading out downward. Figma's are blue: 400–500–600 solid, 50–100–200 soft.
type Tone = { fill: string; shadow: string; value: string; dot: string; swatch: string }
const solid = (hue: RevenueProductLineColor): Tone => ({
  fill: { blue: "from-primary-blue-400 via-primary-blue-500 to-primary-blue-600", purple: "from-primary-purple-400 via-primary-purple-500 to-primary-purple-600", green: "from-primary-green-400 via-primary-green-500 to-primary-green-600", orange: "from-primary-orange-400 via-primary-orange-500 to-primary-orange-600" }[hue],
  // Figma paints later effects on top; CSS paints the first shadow on top (Figma's ring comes before the drop shadow)
  shadow: {
    blue: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-blue-500)]",
    purple: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-purple-500)]",
    green: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-green-500)]",
    orange: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-orange-500)]",
  }[hue],
  value: { blue: "typo-label-03-semibold text-primary-blue-500", purple: "typo-label-03-semibold text-primary-purple-500", green: "typo-label-03-semibold text-primary-green-500", orange: "typo-label-03-semibold text-primary-orange-500" }[hue],
  dot: {
    blue: "bg-primary-blue-500 [--dot-ring:var(--primary-blue-500)]",
    purple: "bg-primary-purple-500 [--dot-ring:var(--primary-purple-500)]",
    green: "bg-primary-green-500 [--dot-ring:var(--primary-green-500)]",
    orange: "bg-primary-orange-500 [--dot-ring:var(--primary-orange-500)]",
  }[hue],
  swatch: { blue: "bg-primary-blue-500", purple: "bg-primary-purple-500", green: "bg-primary-green-500", orange: "bg-primary-orange-500" }[hue],
})
const soft = (hue: RevenueProductLineColor): Tone => ({
  fill: { blue: "from-primary-blue-50 via-primary-blue-100 to-primary-blue-200", purple: "from-primary-purple-50 via-primary-purple-100 to-primary-purple-200", green: "from-primary-green-50 via-primary-green-100 to-primary-green-200", orange: "from-primary-orange-50 via-primary-orange-100 to-primary-orange-200" }[hue],
  shadow: {
    blue: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-blue-200)]",
    purple: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-purple-200)]",
    green: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-green-200)]",
    orange: "shadow-[0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2),0_0_0_1px_var(--primary-orange-200)]",
  }[hue],
  value: { blue: "typo-label-03-medium text-primary-blue-200", purple: "typo-label-03-medium text-primary-purple-200", green: "typo-label-03-medium text-primary-green-200", orange: "typo-label-03-medium text-primary-orange-200" }[hue],
  dot: {
    blue: "bg-primary-blue-200 [--dot-ring:var(--primary-blue-200)]",
    purple: "bg-primary-purple-200 [--dot-ring:var(--primary-purple-200)]",
    green: "bg-primary-green-200 [--dot-ring:var(--primary-green-200)]",
    orange: "bg-primary-orange-200 [--dot-ring:var(--primary-orange-200)]",
  }[hue],
  swatch: { blue: "bg-primary-blue-200", purple: "bg-primary-purple-200", green: "bg-primary-green-200", orange: "bg-primary-orange-200" }[hue],
})
// The note's icon tile and figure take the benchmark's hue (Figma's are blue-50 and blue-500).
const accents: Record<RevenueProductLineColor, { tile: string; figure: string }> = {
  blue: { tile: "bg-primary-blue-50 text-primary-blue-500", figure: "text-primary-blue-500" },
  purple: { tile: "bg-primary-purple-50 text-primary-purple-500", figure: "text-primary-purple-500" },
  green: { tile: "bg-primary-green-50 text-primary-green-500", figure: "text-primary-green-500" },
  orange: { tile: "bg-primary-orange-50 text-primary-orange-500", figure: "text-primary-orange-500" },
}
const toneOf = (s: RevenueProductLineSeries, i: number) => ((s.tone ?? (i === 0 ? "solid" : "soft")) === "solid" ? solid : soft)(s.color ?? "blue")

const sampleRevenueProductLineSeries: RevenueProductLineSeries[] = [
  { id: "industry", label: "Industry Avg. churn" },
  { id: "top", label: "Top Quartile churn" },
]

// The Figma card. Each rate stands its bar as tall as Figma draws it on the 0–50% axis (whole pixels, as drawn); the
// labels over the bars read the bars (Figma's say 34.6%, 18.4%, 38.2%, 23.8%, 36.3% and 32.5%: see FIGMA-GAPS.md).
const sampleRevenueProductLines: RevenueProductLine[] = [
  { label: "Subscription", values: { industry: 31.1, top: 17.5 } },
  { label: "Expenses", values: { industry: 37.8, top: 23.2 } },
  { label: "Investment", values: { industry: 32.7, top: 31 } },
]

/** The largest drop from the first series to the second over the product lines, in percent of the first. */
function bestChange(data: RevenueProductLine[], series: RevenueProductLineSeries[]) {
  const [benchmark, other] = series
  if (!benchmark || !other) return undefined
  const changes = data.flatMap((line) => {
    const base = line.values[benchmark.id] ?? 0
    return base > 0 ? [((base - (line.values[other.id] ?? 0)) / base) * 100] : []
  })
  return changes.length ? Math.max(...changes) : undefined
}

/**
 * Where everything sits at a plot width. The product lines are spread between 43px in and 46px short of the right
 * edge (Figma's bar row), each a group of bars 10px apart around its centre: the shown series' bars, side by side, and
 * a hidden series' bar where it was, at no height. A value's bar stands on the axis and reaches its level on the ticks'
 * scale, its top on a whole pixel like Figma's. The lines between the product lines sit midway between them.
 */
function layoutChart(data: RevenueProductLine[], series: RevenueProductLineSeries[], hidden: string[], ticks: number[], width: number) {
  const n = data.length
  const k = Math.max(1, series.length)
  const room = Math.max(0, width - INSET_LEFT - INSET_RIGHT)
  const fit = ((n ? room / n : room) - GROUP_GAP * (n > 1 ? (n - 1) / n : 0) - (k - 1) * BAR_GAP) / k
  const barWidth = Math.max(4, Math.min(BAR_WIDTH, fit))
  const groupWidth = k * barWidth + (k - 1) * BAR_GAP
  const first = INSET_LEFT + groupWidth / 2
  const last = width - INSET_RIGHT - groupWidth / 2
  const centres = data.map((_, i) => (n > 1 ? first + (i * (last - first)) / (n - 1) : (first + last) / 2))
  const lo = ticks[0] ?? 0
  const hi = ticks[ticks.length - 1] ?? 1
  const shown = series.filter((s) => !hidden.includes(s.id))
  const groups = data.map((line, i) => {
    const shownWidth = shown.length * barWidth + Math.max(0, shown.length - 1) * BAR_GAP
    const bars = series.map((s, j) => {
      const off = hidden.includes(s.id)
      const slot = off ? j : shown.indexOf(s)
      const x = off ? centres[i] - groupWidth / 2 + slot * (barWidth + BAR_GAP) : centres[i] - shownWidth / 2 + slot * (barWidth + BAR_GAP)
      const value = line.values[s.id] ?? 0
      const height = off || hi <= lo ? 0 : Math.max(0, Math.round(((Math.min(Math.max(value, lo), hi) - lo) / (hi - lo)) * SPAN))
      return { id: s.id, x, value, height, off }
    })
    const top = BASE - Math.max(0, ...bars.filter((bar) => !bar.off).map((bar) => bar.height))
    const visible = bars.filter((bar) => !bar.off)
    const left = visible.length ? Math.min(...visible.map((bar) => bar.x)) : centres[i]
    const right = visible.length ? Math.max(...visible.map((bar) => bar.x + barWidth)) : centres[i]
    return { centre: centres[i], top, left, right, bars }
  })
  const dividers = centres.slice(1).map((c, i) => Math.round((centres[i] + c) / 2))
  const columns = centres.map((c, i) => {
    const from = i > 0 ? (centres[i - 1] + c) / 2 : 0
    const to = i < n - 1 ? (c + centres[i + 1]) / 2 : width
    return { left: from, width: to - from }
  })
  return { barWidth, groups, dividers, columns, level: (value: number) => (hi > lo ? BASE - ((value - lo) / (hi - lo)) * SPAN : BASE) }
}

/** A bar's value over it, counting from the previous one when it changes. */
function BarValue({ value, format, className }: { value: number; format: (n: number) => string; className: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useCountUp(ref, value, format, { duration: MORPH })
  return (
    <span ref={ref} data-slot="revenue-by-product-line-chart-value" data-value={value} className={cn("hug-w whitespace-nowrap", className)}>
      {format(value)}
    </span>
  )
}

type TooltipRow = { id: string; label: string; value: number; swatch: string }
type TooltipText = { title: string; rows: TooltipRow[]; change?: number }

/** A tooltip figure, counting from the previous one when it changes. */
function TooltipValue({ value, format, counting, className }: { value: number; format: (n: number) => string; counting: boolean; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useCountUp(ref, value, format, { enabled: counting, duration: 400 })
  return (
    <span ref={ref} className={cn("hug-w", className)}>
      {format(value)}
    </span>
  )
}

/** The tooltip's rows. Rendered twice: visible (its numbers count) and as an invisible copy that is measured. */
function TooltipRows({
  text,
  format,
  formatChange,
  dividerWidth,
  counting = false,
}: {
  text: TooltipText
  format: (n: number) => string
  formatChange: (n: number) => string
  dividerWidth: number
  counting?: boolean
}) {
  const dash = fittedDash(dividerWidth, 3, 3)
  const down = (text.change ?? 0) >= 0
  return (
    <>
      <span className="typo-label-02-medium hug-w text-fg-loud">{text.title}</span>
      {text.rows.map((row) => (
        <span key={row.id} className="flex items-center gap-1.5">
          <ChartSwatch className={cn("h-5 w-1", row.swatch)} />
          <TooltipValue value={row.value} format={format} counting={counting} className="typo-label-03-medium text-fg-loud" />
          <span className="typo-label-02-regular hug-w text-fg-soft">{row.label}</span>
        </span>
      ))}
      {text.change !== undefined && (
        <>
          {/* Icon/Soft, dashed 3/3 and fitted to the width; drawn over the 1px above its spot, like Figma's line */}
          <svg aria-hidden width={dividerWidth} height={1} className="-mt-px block shrink-0 overflow-visible">
            <line x1={0} x2={dividerWidth} y1={0.5} y2={0.5} className="stroke-icon-soft" {...dash} />
          </svg>
          {/* lower churn is the good outcome: green with the arrow down, red with the arrow up when it is higher */}
          <span className={cn("flex items-center gap-1", down ? "text-primary-green-500" : "text-error-500")}>
            {down ? <ArrowCircleDownIcon className="shrink-0" /> : <ArrowCircleUpIcon className="shrink-0" />}
            <span className="typo-label-02-medium hug-w whitespace-nowrap">
              <TooltipValue value={Math.abs(text.change)} format={formatChange} counting={counting} /> {down ? "lower churn" : "higher churn"}
            </span>
          </span>
        </>
      )}
    </>
  )
}

const defaultInsight = (figure: React.ReactNode, change: number) => (
  <>
    Chênh lệch lớn nhất: giá trị thứ hai {change < 0 ? "cao hơn" : "thấp hơn"} giá trị thứ nhất tới {figure}.
  </>
)

/**
 * "Revenue by Product Line Chart" from the Keitoto library: churn rates side by side for each product line, the
 * industry average in solid blue against the top quartile in soft blue, with each rate over its glossy bar, and a note
 * on how much lower the top quartile's churn runs. Hover (or tap) a product line to dim the others and see both rates
 * and the gap in a tooltip; click or the arrow keys keep one selected. The legend turns a series off: its bars sink away
 * and the others close up. Animated with anime.js: the grid draws in, the bars grow from the axis one product line after
 * another with their rates counting up, and the note's figure counts up; a new axis or data regrows the bars from where
 * they are while the rates count.
 */
function RevenueByProductLineChart({
  title = "Doanh thu theo nhóm",
  description = "",
  dataSource = "",
  dataSourceHref,
  onInfoClick,
  label = "",
  series = sampleRevenueProductLineSeries,
  data = sampleRevenueProductLines,
  ticks: ticksProp,
  hiddenSeries: hiddenProp,
  defaultHiddenSeries,
  onHiddenSeriesChange,
  index: indexProp,
  defaultIndex,
  onIndexChange,
  insight = defaultInsight,
  actionLabel = "",
  format: formatValue,
  tickFormat: formatTick,
  onActionClick,
  locale = "vi-VN",
  className,
  ...props
}: RevenueByProductLineChartProps) {
  const n = data.length
  const [hidden, setHidden] = useControllableState({ value: hiddenProp, defaultValue: defaultHiddenSeries ?? NONE, onChange: onHiddenSeriesChange })
  const [indexValue, setIndex] = useControllableState<number | null>({
    value: indexProp,
    defaultValue: defaultIndex ?? null,
    onChange: (next) => onIndexChange?.(next, next !== null ? (data[next] ?? null) : null),
  })
  const shownSeries = series.filter((s) => !hidden.includes(s.id))
  const max = Math.max(0, ...data.flatMap((line) => (shownSeries.length ? shownSeries : series).map((s) => line.values[s.id] ?? 0)))
  const ticks = React.useMemo(() => (ticksProp?.length ? [...ticksProp].sort((a, b) => a - b) : niceTicks(0, max > 0 ? max : 1, TICK_COUNT)), [ticksProp, max])
  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const width = plot.width || PLOT_WIDTH
  const chart = React.useMemo(() => layoutChart(data, series, hidden, ticks, width), [data, series, hidden, ticks, width])
  const { barWidth, groups, dividers, columns, level } = chart
  const change = bestChange(data, series)

  const [hovered, setHovered] = React.useState<number | null>(null)
  const selected = indexValue !== null && n ? Math.min(Math.max(Math.round(indexValue), 0), n - 1) : null
  const active = hovered !== null && hovered < n ? hovered : selected
  const line = active !== null ? data[active] : undefined
  const group = active !== null ? groups[active] : undefined

  const rate = React.useCallback((value: number) => (formatValue ? formatValue(value) : formatPercent(value, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 })), [locale, formatValue])
  const tickText = React.useCallback((value: number) => (formatTick ?? formatValue ? (formatTick ?? formatValue)!(value) : formatPercent(value, { locale, maximumFractionDigits: 1 })), [locale, formatTick, formatValue])
  const wholePercent = React.useCallback((value: number) => formatPercent(value, { locale, maximumFractionDigits: 0 }), [locale])
  const [benchmark, other] = series
  const accent = accents[benchmark?.color ?? "blue"]
  const lineChange = (l: RevenueProductLine) => {
    const base = benchmark ? (l.values[benchmark.id] ?? 0) : 0
    return benchmark && other && base > 0 ? ((base - (l.values[other.id] ?? 0)) / base) * 100 : undefined
  }
  const tooltip: TooltipText | undefined = line
    ? {
        title: line.label,
        rows: series.flatMap((s, j) => (hidden.includes(s.id) ? [] : [{ id: s.id, label: s.label, value: line.values[s.id] ?? 0, swatch: toneOf(s, j).swatch }])),
        change: benchmark && other && !hidden.includes(benchmark.id) && !hidden.includes(other.id) ? lineChange(line) : undefined,
      }
    : undefined

  // The tooltip sits right of the product line's bars, or left of them when it would run past the plot, its top 6px
  // under the taller bar's top. Its size is measured on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 170, height: 102 })
  const tipWidth = sizer.width + TIP_PADDING_X
  const tipHeight = sizer.height + TIP_PADDING_Y
  const flipped = group ? Math.round(group.right + TIP_GAP) + tipWidth > width : false
  const tipLeft = group ? (flipped ? Math.max(0, Math.round(group.left - TIP_GAP - tipWidth)) : Math.round(group.right + TIP_GAP)) : 0
  const tipTop = group ? Math.round(Math.min(Math.max(group.top + TIP_DROP, 0), Math.max(0, PLOT_HEIGHT - tipHeight))) : 0

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const figureRef = React.useRef<HTMLSpanElement>(null)
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])
  // what the entrance's callbacks need at play time
  const latest = React.useRef({ change })
  useIsomorphicLayoutEffect(() => {
    latest.current = { change }
  })

  useCountUp(figureRef, Math.abs(change ?? 0), wholePercent, { duration: MORPH })

  // Entrance, once the card is in view: the legend's dots pop, the grid lines draw in and the axis and the lines between
  // the product lines grow up, the labels come in, the bars grow from the axis one product line after another with
  // their rates riding up on them and counting, and the note's icon pops while its figure counts up.
  useChartEntrance(root, (timeline) => {
    const bars = all('[data-slot="revenue-by-product-line-chart-bar"]')
    const figure = figureRef.current
    timeline
      .add(all('[data-slot="chart-legend-dot"]'), { scale: { from: 0.4 }, opacity: { from: 0 }, duration: 600, ease: "outBack(2)", delay: stagger(90) }, 0)
      .add(all('[data-slot="revenue-by-product-line-chart-grid-line"]'), { x2: { from: 0 }, duration: 900, ease: "outQuad", delay: stagger(45, { from: "last" }) }, 100)
      .add(all('[data-slot="revenue-by-product-line-chart-divider"]'), { y1: { from: PLOT_HEIGHT }, duration: 900, ease: "outExpo", delay: stagger(80) }, 100)
      .add(all('[data-slot="revenue-by-product-line-chart-tick"]'), { opacity: { from: 0 }, translateX: { from: -4 }, duration: 600, ease: "outQuad", delay: stagger(45, { from: "last" }) }, 200)
      .add(all('[data-slot="revenue-by-product-line-chart-axis-label"] > span'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(LINE_STAGGER) }, 300)
    for (const bar of bars) {
      const i = Number(bar.dataset.line)
      const j = Number(bar.dataset.position)
      const at = BARS_AT + i * LINE_STAGGER + j * BAR_STAGGER
      timeline.add(bar, { height: { from: 0 }, duration: GROW, ease: "outExpo" }, at)
      const value = bar.parentElement?.querySelector<HTMLElement>('[data-slot="revenue-by-product-line-chart-value"]')
      if (value) {
        const counter = { t: 0 }
        const count = () => (value.textContent = rate(Number(value.dataset.value) * counter.t))
        count()
        timeline
          .add(value, { opacity: { from: 0 }, duration: 400, ease: "outQuad" }, at)
          .add(counter, { t: [0, 1], duration: GROW, ease: "outExpo", onUpdate: count, onComplete: () => (value.textContent = rate(Number(value.dataset.value))) }, at)
      }
    }
    const notes = all('[data-slot="revenue-by-product-line-chart-note-icon"]')
    if (notes.length) timeline.add(notes, { scale: { from: 0.6 }, opacity: { from: 0 }, duration: 700, ease: "outBack(1.8)" }, 500)
    if (figure) {
      const counter = { t: 0 }
      const count = () => (figure.textContent = wholePercent(Math.abs(latest.current.change ?? 0) * counter.t))
      count()
      timeline.add(counter, { t: [0, 1], duration: 1400, ease: "outExpo", onUpdate: count }, 600)
    }
    return () => {
      if (figure) figure.textContent = wholePercent(Math.abs(latest.current.change ?? 0))
      for (const value of all('[data-slot="revenue-by-product-line-chart-value"]')) value.textContent = rate(Number(value.dataset.value))
    }
  })

  // A new layout (a series turned off or on, a new axis or new data) slides every bar from where it was and grows or
  // shrinks it from its height on screen (React has already set the new one, so the heights on screen are kept here);
  // a resize just redraws.
  const placed = groups.map((g) => g.bars.map((bar) => ({ x: bar.x, height: bar.height })))
  const placedKey = placed.map((g) => g.map((bar) => `${bar.x},${bar.height}`).join(";")).join("|")
  const lastLayout = React.useRef({ placed, width })
  const onScreen = React.useRef(new Map<string, number>())
  useIsomorphicLayoutEffect(() => {
    const before = lastLayout.current
    lastLayout.current = { placed, width }
    const heights = onScreen.current
    for (const bar of all('[data-slot="revenue-by-product-line-chart-bar"]')) {
      const i = Number(bar.dataset.line)
      const j = Number(bar.dataset.position)
      const key = `${i}-${j}`
      const from = before.placed[i]?.[j]
      const to = placed[i]?.[j]
      if (!to) continue
      const start = heights.get(key) ?? from?.height ?? to.height
      heights.set(key, to.height)
      if (reduced || before.width !== width || !from) continue
      const column = bar.parentElement
      if (column && from.x !== to.x)
        animate(column, { translateX: [from.x - to.x + utils.get(column, "translateX", false), 0], duration: MORPH, ease: "outExpo", onComplete: releaseStyles("transform") })
      if (start !== to.height)
        animate(bar, {
          height: [start, to.height],
          duration: MORPH,
          ease: "outExpo",
          onUpdate: () => heights.set(key, parseFloat(bar.style.height) || 0),
          onComplete: () => heights.set(key, to.height),
        })
    }
  }, [placedKey, width, reduced])

  // The tooltip slides to the new product line; when it changes sides it pops in again.
  const tipOn = !!tooltip
  const lastTip = React.useRef({ tipLeft, tipTop, flipped, width, on: tipOn })
  useIsomorphicLayoutEffect(() => {
    const before = lastTip.current
    lastTip.current = { tipLeft, tipTop, flipped, width, on: tipOn }
    const tip = tipRef.current
    if (!tip || reduced || before.width !== width) return
    if (!before.on || before.flipped !== flipped) {
      animate(tip, { opacity: [0, 1], scale: [0.94, 1], translateY: [4, 0], duration: 300, ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
      return
    }
    if (before.tipLeft === tipLeft && before.tipTop === tipTop) return
    animate(tip, {
      translateX: [before.tipLeft - tipLeft + utils.get(tip, "translateX", false), 0],
      translateY: [before.tipTop - tipTop + utils.get(tip, "translateY", false), 0],
      duration: 450,
      ease: "outExpo",
      onComplete: releaseStyles("transform"),
    })
  }, [tipLeft, tipTop, flipped, width, tipOn, reduced])

  // New ticks fade their labels in again (a counting label would change the column's width, and the plot's with it).
  const ticksKey = ticks.join(";")
  const lastTicks = React.useRef(ticksKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastTicks.current
    lastTicks.current = ticksKey
    if (before === ticksKey || reduced) return
    animate(all('[data-slot="revenue-by-product-line-chart-tick"]'), { opacity: [0, 1], translateX: [-4, 0], duration: 500, delay: stagger(35, { from: "last" }), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
  }, [ticksKey, reduced])

  const toggle = (id: string) => setHidden(hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id])
  const select = (next: number | null) => setIndex(next === null || !n ? null : Math.min(Math.max(next, 0), n - 1))
  const onLineKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (event.key === "Escape") {
      setHovered(null)
      select(null)
      return
    }
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    const target = Math.min(Math.max(next, 0), n - 1)
    setHovered(null)
    select(target)
    root.current?.querySelectorAll<HTMLButtonElement>('[data-slot="revenue-by-product-line-chart-line"]')[target]?.focus()
  }
  const describe = (l: RevenueProductLine) => `${l.label}: ${series.map((s) => `${s.label} ${rate(l.values[s.id] ?? 0)}`).join(", ")}`

  const gridDash = fittedDash(width, 5, 5)
  const focusable = selected ?? 0

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full gap-0 p-0", className)} {...props}>
      {/* Figma draws the 1px Border/Soft line inside the 82px header: 19px of padding under the content, not 20 */}
      <div className="flex items-center gap-2 border-b border-border-soft p-5 pb-[19px]">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
          <p className="typo-heading-01-semibold -my-0.5 truncate py-0.5 text-fg-loud">{title}</p>
          {description && <p className="typo-label-02-medium -my-0.5 truncate py-0.5 text-fg-soft">{description}</p>}
        </div>
        {dataSource && (
          <div className="flex shrink-0 items-center gap-2">
            <p className="typo-label-02-medium hug-w whitespace-nowrap text-fg-soft">Data source:</p>
            {/* Figma "Stripe Label": a raw #097df6 (blue-500's value), underlined and over a 1px line inside its 2px padding. The
                font's underline is thinner than a pixel there: it covers half a pixel row, drawn here as a 1px line at 50%. */}
            {dataSourceHref ? (
              <a
                href={dataSourceHref}
                target="_blank"
                rel="noreferrer"
                className="flex rounded-[2px] border-b border-[#097df6] px-0.5 pt-0.5 pb-px text-[#097df6] outline-none transition-opacity duration-200 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary-blue-500/40"
              >
                <span className="typo-label-02-medium hug-w whitespace-nowrap underline decoration-[#097df6]/50 decoration-from-font [text-underline-position:from-font]">{dataSource}</span>
              </a>
            ) : (
              <span className="flex border-b border-[#097df6] px-0.5 pt-0.5 pb-px text-[#097df6]">
                <span className="typo-label-02-medium hug-w whitespace-nowrap underline decoration-[#097df6]/50 decoration-from-font [text-underline-position:from-font]">{dataSource}</span>
              </span>
            )}
            <button
              type="button"
              aria-label="Về dữ liệu"
              onClick={onInfoClick}
              className="relative size-4 shrink-0 cursor-pointer rounded-full text-icon-soft outline-none transition-colors duration-200 before:absolute before:-inset-2 hover:text-icon-normal focus-visible:ring-2 focus-visible:ring-primary-blue-500/40"
            >
              <InfoCircleLineIcon />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-start gap-4 px-5 py-4">
        <p className="typo-label-02-regular min-w-0 flex-1 text-fg-normal">{label}</p>
        {series.length > 0 && (
          <div className="flex shrink-0 items-center gap-4">
            {series.map((s, j) => {
              const off = hidden.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  data-slot="revenue-by-product-line-chart-legend-item"
                  aria-pressed={!off}
                  onClick={() => toggle(s.id)}
                  className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary-blue-500/40"
                >
                  <span data-off={off || undefined} className="flex items-center gap-2 transition-opacity duration-200 data-off:opacity-40">
                    <ChartLegendDot size={12} className={toneOf(s, j).dot} />
                    <span className="typo-label-02-medium hug-w whitespace-nowrap text-fg-soft">{s.label}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-start gap-3">
          {/* Figma "Y Axis Labels": 28px wide (wider labels widen it), spread over the plot's height, left-aligned */}
          <div aria-hidden className="hug-w flex min-w-[28px] shrink-0 flex-col justify-between" style={{ height: PLOT_HEIGHT }}>
            {[...ticks].reverse().map((tick) => (
              <span key={tick} data-slot="revenue-by-product-line-chart-tick" className="typo-label-02-regular whitespace-nowrap text-fg-soft">
                {tickText(tick)}
              </span>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div ref={plotRef} data-slot="revenue-by-product-line-chart-plot" className="relative" style={{ height: PLOT_HEIGHT }} onPointerLeave={() => setHovered(null)}>
              <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
                {/* Figma "Grid Line": 1px over [y, y + 1] at each tick's level, Border/Soft dashed 5/5, the axis Border/Sub and solid */}
                {ticks.map((tick, i) => (
                  <line
                    key={i}
                    data-slot="revenue-by-product-line-chart-grid-line"
                    x1={0}
                    x2={width}
                    y1={level(tick) + 0.5}
                    y2={level(tick) + 0.5}
                    className={i === 0 ? "stroke-border-sub" : "stroke-border-soft"}
                    {...(i === 0 ? {} : gridDash)}
                  />
                ))}
                {/* and over them, 1px over [x, x + 1] the full height: the axis (Border/Sub), then the lines between the product lines */}
                <line data-slot="revenue-by-product-line-chart-divider" x1={0.5} x2={0.5} y1={0} y2={PLOT_HEIGHT} className="stroke-border-sub" />
                {dividers.map((x, i) => (
                  <line key={i} data-slot="revenue-by-product-line-chart-divider" x1={x + 0.5} x2={x + 0.5} y1={0} y2={PLOT_HEIGHT} className="stroke-border-soft" />
                ))}
              </svg>

              <div aria-hidden className="pointer-events-none absolute inset-0">
                {groups.map((g, i) =>
                  g.bars.map((bar, j) => {
                    const s = series[j]
                    const tone = toneOf(s, j)
                    const left = Math.floor(bar.x)
                    const fraction = Math.round((bar.x - left) * 1000) / 1000
                    const dim = active !== null && active !== i
                    return (
                      <div
                        key={`${i}-${s.id}`}
                        data-slot="revenue-by-product-line-chart-column"
                        className={cn("absolute bottom-px flex flex-col items-center transition-opacity duration-300 motion-reduce:transition-none", bar.off && "opacity-0")}
                        // a whole-pixel left plus the fraction as a translate: Chrome anti-aliases the edges like Figma
                        style={{ left, width: barWidth, gap: VALUE_GAP, translate: fraction ? `${fraction}px 0` : undefined }}
                      >
                        <BarValue
                          value={bar.value}
                          format={rate}
                          className={cn(tone.value, "transition-opacity duration-300 motion-reduce:transition-none", dim && "opacity-40", barWidth < VALUE_MIN_BAR && "invisible")}
                        />
                        <span
                          data-slot="revenue-by-product-line-chart-bar"
                          data-line={i}
                          data-position={j}
                          className={cn(
                            "relative w-full shrink-0 rounded-t-xl rounded-b-[2px] bg-linear-to-b/srgb transition-opacity duration-300 motion-reduce:transition-none",
                            tone.fill,
                            tone.shadow,
                            dim && "opacity-40",
                          )}
                          style={{ height: bar.height }}
                        >
                          {/* Figma's white inner glow (46%), then its 1px inside stroke: white at 36% fading out downward (an inset
                              ring under a fading mask, so it anti-aliases on the half-pixel bars like Figma's) */}
                          <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_27.8px_rgb(255_255_255/0.46)]" />
                          <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.36)] [mask-image:linear-gradient(#000,transparent)]" />
                        </span>
                      </div>
                    )
                  }),
                )}
              </div>

              <div role="group" aria-label={`${label || title} theo nhóm`}>
                {columns.map((column, i) => (
                  <button
                    key={i}
                    type="button"
                    data-slot="revenue-by-product-line-chart-line"
                    aria-label={describe(data[i])}
                    aria-pressed={i === selected}
                    tabIndex={i === focusable ? 0 : -1}
                    onPointerEnter={() => setHovered(i)}
                    onClick={() => select(i === selected ? null : i)}
                    onKeyDown={(event) => onLineKeyDown(event, i)}
                    className="group/line absolute inset-y-0 cursor-pointer outline-none"
                    style={{ left: column.left, width: column.width }}
                  >
                    {/* keyboard focus rings the product line's bars */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute rounded-2xl opacity-0 ring-2 ring-primary-blue-500/40 transition-opacity duration-150 group-focus-visible/line:opacity-100"
                      style={{ left: groups[i].left - column.left - 8, width: groups[i].right - groups[i].left + 16, top: Math.max(0, groups[i].top - 32), bottom: -4 }}
                    />
                  </button>
                ))}
              </div>

              {tooltip && (
                <div
                  ref={tipRef}
                  aria-hidden
                  data-slot="revenue-by-product-line-chart-tooltip"
                  className={cn(
                    "pointer-events-none absolute z-10 flex flex-col items-start gap-2 overflow-hidden rounded-xl bg-surface-white px-3 py-2 whitespace-nowrap",
                    // Figma paints later effects on top; CSS paints the first shadow on top
                    "shadow-[0_0_0_1px_#ececec,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                  )}
                  style={{ left: tipLeft, top: tipTop }}
                >
                  <TooltipRows text={tooltip} format={rate} formatChange={wholePercent} dividerWidth={sizer.width} counting />
                </div>
              )}
              {/* the same rows with their final text, measured to place the tooltip (the visible ones change width while they count) */}
              {tooltip && (
                <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col items-start gap-2 whitespace-nowrap">
                  <TooltipRows text={tooltip} format={rate} formatChange={wholePercent} dividerWidth={0} />
                </span>
              )}
            </div>

            {/* each product line's label centred under its bars (Figma centres them in even columns: see FIGMA-GAPS.md) */}
            <div aria-hidden className="relative h-3.5">
              {groups.map((g, i) => (
                <span key={`${i}-${data[i].label}`} data-slot="revenue-by-product-line-chart-axis-label" className="absolute top-0" style={{ left: g.centre }}>
                  <span className={cn("typo-label-02-regular block -translate-x-1/2 whitespace-nowrap transition-colors duration-200", active === i ? "text-fg-loud" : "text-fg-soft")}>
                    {data[i].label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span data-slot="revenue-by-product-line-chart-note-icon" className={cn("flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5", accent.tile)}>
              <LineChartUpIcon />
            </span>
            {/* Figma: Description/02 with the figure in Description/03 Semibold, 20px lines (22px for the line holding the figure) */}
            <p className="typo-description-02-medium min-w-0 flex-1 leading-5 text-fg-normal">
              {change !== undefined
                ? insight(
                    <span ref={figureRef} className={cn("typo-description-03-semibold leading-[22px]", change < 0 ? "text-error-500" : accent.figure)}>
                      {wholePercent(Math.abs(change))}
                    </span>,
                    change,
                  )
                : null}
            </p>
          </div>
          {actionLabel ? (
            <>
          <span aria-hidden className="h-10 w-px shrink-0 rounded-[2px] bg-border-soft" />
          <div className="flex w-[188px] shrink-0 items-start gap-3">
            <p className="typo-description-02-medium min-w-0 flex-1 leading-5 text-fg-normal">{actionLabel}</p>
            <ChartButton
              size="icon"
              corner="rounded"
              aria-label={actionLabel}
              onClick={onActionClick}
              className="[&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:translate-x-px hover:[&_svg]:-translate-y-px"
            >
              <ArrowUpRightIcon />
            </ChartButton>
          </div>
            </>
          ) : null}
        </div>
      </div>
    </ChartCard>
  )
}

export {
  RevenueByProductLineChart,
  sampleRevenueProductLineSeries,
  sampleRevenueProductLines,
  type RevenueByProductLineChartProps,
  type RevenueProductLine,
  type RevenueProductLineColor,
  type RevenueProductLineSeries,
}
