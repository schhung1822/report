"use client"

import { animate, stagger, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ChartChangeBadge } from "@/components/ui/chart-change-badge"
import { CalendarSolidIcon, ChevronDownIcon, DotsHorizontalIcon, InfoCircleLineIcon } from "@/components/ui/chart-icons"
import { ChartMenu, ChartMenuContent, ChartMenuRadioGroup, ChartMenuRadioItem, ChartMenuTrigger } from "@/components/ui/chart-menu"
import { ChartTooltipLines } from "@/components/ui/chart-tooltip-lines"
import { releaseStyles, useChartEntrance, useCountUp, useInView, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency, formatDay } from "@/lib/chart-format"
import { barTicks, fittedDash, starPath, trianglePath } from "@/lib/chart-series"
import { cn } from "@/lib/utils"

type TotalRevenueMonth = {
  /** The month, as the ISO date of its first day ("2026-03-01"). */
  month: string
  /** The month's total revenue: its bar. */
  revenue: number
  /** The month's net cash flow (money in minus money out): the figure over the chart while the month is highlighted. */
  netCashFlow: number
}

/** A period of the menu: the latest `months` months of the data. */
type TotalRevenuePeriod = { value: string; label: string; months: number }

type TotalRevenueChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  title?: string
  /** The label over the highlighted month's net cash flow. */
  valueLabel?: string
  /** The soft text after the change badge. */
  changeLabel?: string
  /** The line under the chart; "Total revenue and monthly net cash flow for the last <period>." by default. */
  description?: string
  /** One entry per month, oldest first. The month before a period's first one gives that month its change. */
  data?: TotalRevenueMonth[]
  periods?: TotalRevenuePeriod[]
  period?: string
  defaultPeriod?: string
  onPeriodChange?: (period: string) => void
  /** The y-axis values, lowest first (one grid line each). Six round values from $0 by default. */
  ticks?: number[]
  /** The highlighted month (an index into `data`). */
  index?: number
  /** Figma's March with the sample, the latest month with your data. */
  defaultIndex?: number
  onIndexChange?: (index: number, month: TotalRevenueMonth) => void
  /** Text for a month under its bar ("Mar") and in the tooltip and the bars' labels ("March 2026"). */
  formatMonth?: (month: string, context: "axis" | "label") => string
  /** Called by the ⋯ button. */
  onMoreClick?: () => void
  locale?: string
  currency?: string
}

/** A bar: its left edge, its width and the y of its top (the back edge of its lid). */
type Bar = { x: number; width: number; top: number }
type Point = [number, number]

// Figma geometry ("Total Revenue Chart" 1473:79806)
const PLOT_WIDTH = 511
const PLOT_HEIGHT = 302 // the bars stand on the plot's bottom edge
const TOP = 7 // the highest tick's grid line, level with the middle of its label
const BAR_WIDTH = 391 / 6 // 65.17: six bars 24px apart over the 511px plot
const BAR_GAP = 24
// A bar is seen from above: its lid, a trapezoid 26px deep, rests on the front face, its back edge marking the value.
const LID = 26
const LID_LEFT = 5.2031 // the back edge starts this far in from the bar's left…
const LID_RIGHT = 5.293 // …and ends this far in from its right (Figma's lid is 0.09px lopsided)
const GREY_STROKE = 1 // the grey bars' inside stroke
const LIT_STROKE = 1.4556 // the lit bar's
const TICK_COUNT = 6
const TIP_GAP = 8 // the tooltip sits 8px beside the hovered bar
const TIP_PADDING_X = 24 // its 8px left and 16px right padding
const TIP_PADDING_Y = 16 // and 8px top and bottom
const BARS_AT = 200
const BAR_STAGGER = 80
const GROW = 1000
const FILL = 750 // the highlighted bar filling up with blue from the floor
const DRAIN = 450
const MORPH = 800
const GLINT = 72 // the glint's band (turned 20°), parked under the bar until it sweeps up
const SHINE_DELAY = 600 // a month has to stay highlighted this long before its shine loops start
const BAR = '[data-slot="total-revenue-chart-bar"]'

type Sparkle = { x: number; y: number; rx: number; ry: number; star?: boolean; triangle?: boolean; dim?: boolean }

// Figma "stars": a 227 × 177 field of white dots, four-point stars and tiny triangles laid over the lit bar twice (the
// second copy 168.1px lower). These are the ones that can show inside a 65px bar, by their centres from the top left
// of the bar's front face (the upper copy reaches up into the lid); `dim` ones are at 10% in the lower copy.
const SPARKLES: Sparkle[] = [
  { x: 71.376, y: -66.13, rx: 0.9445, ry: 0.87, star: true },
  { x: 19.788, y: -52.483, rx: 1.4165, ry: 1.3045 },
  { x: 67.602, y: -41.782, rx: 0.9445, ry: 0.87 },
  { x: 35.763, y: -40.763, rx: 0.472, ry: 0.4345 },
  { x: 57.05, y: -13.355, rx: 0.472, ry: 0.4345 },
  { x: 71.332, y: -8.12, rx: 0.472, ry: 0.4345 },
  { x: 37.711, y: -6.935, rx: 0.9445, ry: 0.87 },
  { x: 58.122, y: -4.832, rx: 0.472, ry: 0.4345 },
  { x: 26.308, y: -2.448, rx: 0.9445, ry: 0.87, star: true },
  { x: 9.693, y: 5.567, rx: 0.472, ry: 0.4345 },
  { x: 33.116, y: 20.648, rx: 0.9445, ry: 0.87, triangle: true },
  { x: 23.438, y: 34.008, rx: 0.472, ry: 0.4345 },
  { x: 57.085, y: 46.224, rx: 0.472, ry: 0.4345 },
  { x: 13.346, y: 52.4, rx: 0.472, ry: 0.4345 },
  { x: 28.98, y: 53.27, rx: 1.4165, ry: 1.3045 },
  { x: 58.306, y: 59.75, rx: 0.9445, ry: 0.87, star: true },
  { x: 62.493, y: 109.614, rx: 0.472, ry: 0.4345 },
]
const STARS = SPARKLES.filter((sparkle) => sparkle.star)
const SPARKLE_PERIOD = 168.1
const TWINKLE_GROUPS = 3
// Bottom to top: the lower copy blurred (20%) and sharp (40% of dots at 50%), then the upper copy blurred (50%) and
// sharp (30%). The sharp ones are added with plus-lighter; Figma's layer blur 9.5 renders like CSS blur(4.28px).
const SPARKLE_LAYERS = [
  { tile: 1, opacity: 0.2, blur: true },
  { tile: 1, opacity: 0.2, blur: false },
  { tile: 0, opacity: 0.5, blur: true },
  { tile: 0, opacity: 0.3, blur: false },
]

const MONTHS_SHOWN = 6

// The Figma card: January to June 2026 with March highlighted. Every revenue stands its bar where Figma draws it on the
// $0–$25M axis (to the pixel), and March's net cash flow and its rise from February are Figma's $23,561.16 and
// $163,747. June to December 2025 are sample months for the 12-month view and for July's change.
const sampleTotalRevenueData: TotalRevenueMonth[] = [
  { month: "2025-06-01", revenue: 14_820_416.95, netCashFlow: 19_842.37 },
  { month: "2025-07-01", revenue: 16_405_219.37, netCashFlow: 24_108.92 },
  { month: "2025-08-01", revenue: 18_912_560.08, netCashFlow: 15_377.4 },
  { month: "2025-09-01", revenue: 13_286_774.62, netCashFlow: -8_264.15 },
  { month: "2025-10-01", revenue: 19_540_338.15, netCashFlow: 21_906.58 },
  { month: "2025-11-01", revenue: 23_874_031.27, netCashFlow: 33_415.27 },
  { month: "2025-12-01", revenue: 21_208_644.9, netCashFlow: 28_730.64 },
  { month: "2026-01-01", revenue: 20_169_491.53, netCashFlow: 17_204.81 },
  { month: "2026-02-01", revenue: 15_677_966.1, netCashFlow: -140_185.84 },
  { month: "2026-03-01", revenue: 22_542_372.88, netCashFlow: 23_561.16 },
  { month: "2026-04-01", revenue: 17_033_898.31, netCashFlow: 26_880.49 },
  { month: "2026-05-01", revenue: 12_372_881.36, netCashFlow: 9_312.75 },
  { month: "2026-06-01", revenue: 17_966_101.69, netCashFlow: 21_047.33 },
]
const SAMPLE_SELECTED = 9 // March 2026

const defaultPeriods: TotalRevenuePeriod[] = [
  { value: "3m", label: "3 months", months: 3 },
  { value: "6m", label: "6 months", months: MONTHS_SHOWN },
  { value: "12m", label: "12 months", months: 12 },
]

/**
 * Where every month's bar sits for a window of the data: the window's months spread over the plot (six 65.17px bars
 * 24px apart; more get narrower with the same proportions, fewer stay 65.17px and spread out), the months before it
 * further left, off the plot. A bar's top is its revenue on the ticks' scale (the lowest tick on the plot's bottom edge,
 * the highest on the top grid line).
 */
function layoutBars(values: number[], start: number, count: number, width: number, ticks: number[]): Bar[] {
  const ratio = BAR_GAP / BAR_WIDTH
  const fit = count > 0 ? width / (count + (count - 1) * ratio) : width
  const barWidth = Math.min(BAR_WIDTH, fit)
  const gap = count > 1 ? (width - count * barWidth) / (count - 1) : 0
  const lo = ticks[0] ?? 0
  const hi = ticks[ticks.length - 1] ?? 1
  const y = (value: number) => (hi > lo ? PLOT_HEIGHT - ((Math.min(Math.max(value, lo), hi) - lo) / (hi - lo)) * (PLOT_HEIGHT - TOP) : PLOT_HEIGHT)
  return values.map((value, i) => ({
    x: count > 1 ? (i - start) * (barWidth + gap) : (width - barWidth) / 2 + (i - start) * (barWidth + BAR_GAP),
    width: barWidth,
    top: y(value),
  }))
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const polygon = (points: Point[]) => `M ${points.map(([x, y]) => `${r3(x)} ${r3(y)}`).join(" L ")} Z`
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpBar = (a: Bar, b: Bar, t: number): Bar => ({ x: lerp(a.x, b.x, t), width: lerp(a.width, b.width, t), top: lerp(a.top, b.top, t) })
/** Where the blue reaches up to in a bar `level` (0–1) full of it: below the floor when empty, over the top when full. */
const revealLine = (top: number, level: number) => r3(level <= 0 ? PLOT_HEIGHT + 1 : level >= 1 ? top - 1 : top + (1 - level) * (PLOT_HEIGHT - top))

/** Where two lines (a point and a direction each) cross, or null when they run parallel. */
function intersect(a: { p: Point; d: Point }, b: { p: Point; d: Point }): Point | null {
  const det = a.d[0] * b.d[1] - a.d[1] * b.d[0]
  if (Math.abs(det) < 1e-9) return null
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / det
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t]
}

/** A convex polygon (clockwise on screen) moved in by `d` on every side: the middle of an inside stroke 2d wide. */
function insetPolygon(points: Point[], d: number): Point[] {
  const n = points.length
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % n]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const length = Math.hypot(dx, dy) || 1
    return { p: [p[0] - (dy / length) * d, p[1] + (dx / length) * d] as Point, d: [dx, dy] as Point }
  })
  return lines.map((line, i) => intersect(lines[(i + n - 1) % n], line) ?? line.p)
}

/**
 * A bar `grown` (0–1) of its height: its lid (as deep as the bar when the bar is shorter, its slopes kept), its front
 * face below, and the middle lines of both looks' inside strokes. A narrower bar gets a shallower lid in proportion.
 */
function barPaths(bar: Bar, grown = 1) {
  const { x, width } = bar
  const scale = width / BAR_WIDTH
  const height = Math.max(0, PLOT_HEIGHT - bar.top) * grown
  const deep = LID * Math.min(1, scale)
  const lid = Math.min(deep, height)
  const k = deep > 0 ? lid / deep : 0
  const top = PLOT_HEIGHT - height
  const faceTop = top + lid
  const right = x + width
  const lidPoints: Point[] = [
    [x + LID_LEFT * scale * k, top],
    [right - LID_RIGHT * scale * k, top],
    [right, faceTop],
    [x, faceTop],
  ]
  const face = height > 0.01 ? `M ${r3(x)} ${r3(faceTop)} H ${r3(right)} V ${PLOT_HEIGHT} H ${r3(x)} Z` : ""
  const faceHeight = PLOT_HEIGHT - faceTop
  const greyInset = GREY_STROKE / 2
  const litInset = LIT_STROKE / 2
  return {
    top,
    faceTop,
    lid: lid > 0.01 ? polygon(lidPoints) : "",
    face,
    outline: height > 0.01 ? polygon([lidPoints[0], lidPoints[1], [right, faceTop], [right, PLOT_HEIGHT], [x, PLOT_HEIGHT], [x, faceTop]]) : "",
    greyLidStroke: lid > GREY_STROKE + 0.01 ? polygon(insetPolygon(lidPoints, greyInset)) : "",
    litLidStroke: lid > LIT_STROKE + 0.01 ? polygon(insetPolygon(lidPoints, litInset)) : "",
    // Figma's grey face strokes all four sides, the lit one leaves its top open
    greyFaceStroke:
      faceHeight > GREY_STROKE + 0.01
        ? `M ${r3(x + greyInset)} ${r3(faceTop + greyInset)} H ${r3(right - greyInset)} V ${r3(PLOT_HEIGHT - greyInset)} H ${r3(x + greyInset)} Z`
        : "",
    litFaceStroke:
      faceHeight > LIT_STROKE + 0.01
        ? `M ${r3(x + litInset)} ${r3(faceTop)} V ${r3(PLOT_HEIGHT - litInset)} H ${r3(right - litInset)} V ${r3(faceTop)}`
        : "",
  }
}
type BarPaths = ReturnType<typeof barPaths>
const PATH_PARTS = ["lid", "face", "greyLidStroke", "litLidStroke", "greyFaceStroke", "litFaceStroke"] as const

/**
 * The shine of the lit bar: the four layers of the sparkle field and a flare over each four-point star (hidden at
 * rest), each layer clipped to the bar's outline itself (Chrome blends plus-lighter only with what is drawn in the same
 * clipped group, so the face has to be a sibling) and placed at the face's top left by `anchor`.
 */
function Sparkles({ clip, anchor }: { clip: string; anchor: string }) {
  return (
    <>
      {SPARKLE_LAYERS.map((layer, l) => (
        <g key={l} clipPath={clip} opacity={layer.opacity} className={cn("fill-surface-white", layer.blur ? "[filter:blur(4.28px)]" : "mix-blend-plus-lighter")}>
          <g data-part="anchor" transform={anchor}>
            <g data-slot="total-revenue-chart-sparkles">
              {Array.from({ length: TWINKLE_GROUPS }, (_, group) => (
                <g key={group} data-twinkle={group}>
                  {SPARKLES.map((sparkle, i) => {
                    if (i % TWINKLE_GROUPS !== group) return null
                    const s = { ...sparkle, y: sparkle.y + layer.tile * SPARKLE_PERIOD }
                    // the lower sharp copy's dots are white at 50%, its dim ones at 10% in both lower layers
                    const opacity = (layer.tile === 1 && sparkle.dim ? 0.1 : 1) * (layer.tile === 1 && !layer.blur ? 0.5 : 1)
                    const shared = { opacity: opacity < 1 ? opacity : undefined }
                    if (s.star) return <path key={i} d={starPath(s)} {...shared} />
                    if (s.triangle) return <path key={i} d={trianglePath(s)} {...shared} />
                    return <ellipse key={i} cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} {...shared} />
                  })}
                </g>
              ))}
            </g>
          </g>
        </g>
      ))}
      <g clipPath={clip} className="fill-surface-white mix-blend-plus-lighter">
        <g data-part="anchor" transform={anchor}>
          <g data-slot="total-revenue-chart-sparkles">
            {[0, 1].flatMap((tile) =>
              STARS.map((star, i) => (
                <g key={`${tile}-${i}`} transform={`translate(${star.x} ${r3(star.y + tile * SPARKLE_PERIOD)})`}>
                  <path
                    data-slot="total-revenue-chart-flare"
                    d="M0 -5.5L1.056 -1.056L5.5 0L1.056 1.056L0 5.5L-1.056 1.056L-5.5 0L-1.056 -1.056Z"
                    className="origin-center opacity-0 [transform-box:fill-box]"
                  />
                </g>
              )),
            )}
          </g>
        </g>
      </g>
    </>
  )
}

/**
 * "Total Revenue Chart" from the Keitoto library: the highlighted month's net cash flow and its change from the month
 * before, over six months of revenue drawn as bars seen slightly from above (a lid on each), on a $0–$25M dashed grid.
 * The highlighted month (March in Figma) is a blue bar with a field of sparkles; hover previews a month with a tooltip
 * of its revenue, a click or the arrow keys select one, and the period menu shows 3, 6 or 12 months. Animated with
 * anime.js: the grid draws in, the bars rise one after another, then blue fills the highlighted bar from the floor
 * while the net cash flow counts up and the badge pops; another month drains the blue from the old bar and fills the
 * new one while the numbers count, and a new period slides the bars along and rescales them. While a month is lit its
 * sparkles twinkle and drift, the four-point stars flare now and then and a glint sweeps up the bar.
 */
function TotalRevenueChart({
  title = "Total Revenue",
  valueLabel = "Monthly net cash flow",
  changeLabel = "vs last month",
  description,
  data: dataProp,
  periods = defaultPeriods,
  period: periodProp,
  defaultPeriod = "6m",
  onPeriodChange,
  ticks: ticksProp,
  index: indexProp,
  defaultIndex,
  onIndexChange,
  formatMonth,
  onMoreClick,
  locale = "en-US",
  currency = "USD",
  className,
  ...props
}: TotalRevenueChartProps) {
  const data = dataProp ?? sampleTotalRevenueData
  const n = data.length
  const [periodValue, setPeriod] = useControllableState({ value: periodProp, defaultValue: defaultPeriod, onChange: onPeriodChange })
  const period = periods.find((p) => p.value === periodValue) ?? periods[0]
  const count = Math.min(n, Math.max(1, period?.months ?? n))
  const start = n - count
  const [indexValue, setIndex] = useControllableState({
    value: indexProp,
    // the sample opens on Figma's month, your data on its latest
    defaultValue: defaultIndex ?? (dataProp ? n - 1 : SAMPLE_SELECTED),
    onChange: (next: number) => {
      if (data[next]) onIndexChange?.(next, data[next])
    },
  })
  const max = Math.max(0, ...data.slice(start).map((m) => m.revenue))
  const ticksKey = ticksProp?.length ? [...ticksProp].sort((a, b) => a - b).join(";") : barTicks(max, TICK_COUNT).join(";")
  const ticks = React.useMemo(() => ticksKey.split(";").map(Number), [ticksKey])
  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const width = plot.width || PLOT_WIDTH
  const revenues = data.map((m) => m.revenue).join(";")
  const bars = React.useMemo(() => layoutBars(revenues.split(";").map(Number), start, count, width, ticks), [revenues, start, count, width, ticks])
  const keys = data.map((m) => m.month)
  const layoutKey = `${keys.join(";")}|${bars.map((b) => [b.x, b.width, b.top].map(r3).join(",")).join(";")}`

  const [hovered, setHovered] = React.useState<number | null>(null)
  const [focused, setFocused] = React.useState<number | null>(null)
  const selected = n ? Math.min(Math.max(Math.round(indexValue), start), n - 1) : -1
  const active = hovered !== null && hovered >= start && hovered < n ? hovered : selected
  const month = data[active]
  const previous = data[active - 1]
  const change = month && previous ? month.netCashFlow - previous.netCashFlow : undefined

  const money = React.useCallback((value: number) => formatCurrency(value, { locale, currency }), [locale, currency])
  // the change is whole dollars, as in Figma ("$163,747")
  const whole = React.useCallback((value: number) => formatCurrency(Math.abs(value), { locale, currency, maximumFractionDigits: 0 }), [locale, currency])
  const monthText = (date: string, context: "axis" | "label") =>
    formatMonth ? formatMonth(date, context) : formatDay(date, context === "axis" ? { month: "short" } : { month: "long", year: "numeric" }, locale)
  const descriptionText = description ?? `Total revenue and monthly net cash flow for the last ${period?.label.toLowerCase() ?? `${count} months`}.`

  // The tooltip (while a month is hovered or focused) sits 8px right of the bar, or left of it when it would run past
  // the plot, its top level with the bar's (inside the plot). It keeps the last month while it fades out (the highlighted
  // one before the first hover, so its amount counts from month to month). Its size is measured on an invisible copy
  // that holds the final text.
  const tipTarget = hovered !== null && hovered >= start && hovered < n ? hovered : focused !== null && focused >= start && focused < n ? focused : null
  const [tipIndex, setTipIndex] = React.useState<number | null>(tipTarget ?? (active >= 0 ? active : null))
  if (tipTarget !== null && tipTarget !== tipIndex) setTipIndex(tipTarget)
  const tipAt = tipIndex !== null && tipIndex < n ? tipIndex : null
  const tipShown = tipTarget !== null
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 106, height: 38 })
  const tipWidth = sizer.width + TIP_PADDING_X
  const tipHeight = sizer.height + TIP_PADDING_Y
  const tipBar = tipAt !== null ? bars[tipAt] : undefined
  const flipped = tipBar ? tipBar.x + tipBar.width + TIP_GAP + tipWidth > width : false
  const tipLeft = tipBar ? Math.round(flipped ? Math.max(0, tipBar.x - TIP_GAP - tipWidth) : tipBar.x + tipBar.width + TIP_GAP) : 0
  const tipTop = tipBar ? Math.round(Math.min(Math.max(tipBar.top, 0), Math.max(0, PLOT_HEIGHT - tipHeight))) : 0
  const tip = tipAt !== null && data[tipAt] ? { date: monthText(data[tipAt].month, "label"), value: money(data[tipAt].revenue) } : undefined

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const valueRef = React.useRef<HTMLParagraphElement>(null)
  const changeRef = React.useRef<HTMLSpanElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const tipValueRef = React.useRef<HTMLSpanElement>(null)
  const inView = useInView(root)
  const ids = React.useId().replace(/[^\w-]/g, "")
  const value = month?.netCashFlow ?? 0
  const valueText = money(value)
  // what the entrance's callbacks need at play time (the card may be resized before it scrolls into view)
  const latest = React.useRef({ bars, active, value, valueText })
  useIsomorphicLayoutEffect(() => {
    latest.current = { bars, active, value, valueText }
  })
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])
  const barEls = () => all(BAR)

  /** Draws bar i `grown` (0–1) of its height, its blue `level` (0–1) of that from the floor (the grey above it). */
  const drawBar = (el: Element | undefined, bar: Bar | undefined, grown: number, level: number) => {
    if (!el || !bar) return
    const paths = barPaths(bar, grown)
    for (const part of PATH_PARTS) el.querySelectorAll(`[data-part="${part}"]`).forEach((path) => path.setAttribute("d", paths[part]))
    el.querySelector('[data-part="outline"]')?.setAttribute("d", paths.outline)
    // the blue rises from the floor: the lit look below the line, the grey one above it
    const line = revealLine(paths.top, level)
    el.querySelector('[data-part="grey-clip"]')?.setAttribute("height", String(r3(Math.max(0, line + PLOT_HEIGHT))))
    const lit = el.querySelector('[data-part="lit-clip"]')
    lit?.setAttribute("y", String(line))
    lit?.setAttribute("height", String(r3(Math.max(0, 2 * PLOT_HEIGHT - line))))
    el.querySelectorAll('[data-part="anchor"]').forEach((anchor) => anchor.setAttribute("transform", `translate(${r3(bar.x)} ${r3(paths.faceTop)})`))
    el.querySelector('[data-part="glint"]')?.setAttribute("transform", `translate(${r3(bar.x)} ${PLOT_HEIGHT})`)
  }
  // What is on screen, so a change animates from there: each bar's geometry, by month, and how full of blue it is.
  const shown = React.useRef<Map<string, Bar> | null>(null)
  const levels = React.useRef(new Map<string, number>())
  const level = (i: number) => levels.current.get(keys[i]) ?? (i === active ? 1 : 0)
  // The entrance's progress (null without one): how far each bar has risen and the highlighted one has filled. A
  // redraw before it is done (the card resized as its font loads, another month hovered) keeps the bars where it has them.
  const growing = React.useRef<{ grown: number[]; fill: { t: number } } | null>(null)
  const fills = React.useRef(new Map<string, JSAnimation>())
  /** Draws every bar as far as the entrance has it: risen `grown`, the highlighted month's blue filled to `fill`. */
  const drawEntrance = (els: Element[], entrance: NonNullable<typeof growing.current>, barsNow: Bar[], activeNow: number) =>
    els.forEach((el, i) => {
      const filled = i === activeNow ? entrance.fill.t : 0
      levels.current.set(keys[i], filled)
      drawBar(el, barsNow[i], entrance.grown[i] ?? 1, filled)
    })

  // New values count from the previous ones.
  useCountUp(valueRef, value, money, { duration: 700 })
  useCountUp(changeRef, change ?? 0, whole, { duration: 700 })
  useCountUp(tipValueRef, tipAt !== null ? (data[tipAt]?.revenue ?? 0) : 0, money, { duration: 450 })

  // The shine loops start once the entrance is over (they never start with reduced motion).
  const [lit, setLit] = React.useState(false)

  // Entrance, once the card is in view: the grid lines draw in from the right (as Figma draws them) and the ticks come
  // in, the bars rise from the floor one after another, then blue fills the highlighted bar from the floor while its
  // net cash flow counts up, the badge pops and a glint sweeps up the bar; the months and the line under the chart
  // come in on the way.
  useChartEntrance(root, (timeline) => {
    const els = barEls()
    // the months before the period are off the plot: just there
    const entrance = { grown: els.map((_, i): number => (i < start ? 1 : 0)), fill: { t: 0 } }
    growing.current = entrance
    const draw = () => drawEntrance(els, entrance, latest.current.bars, latest.current.active)
    draw()
    const gridLines = all('[data-slot="total-revenue-chart-grid-line"]')
    // (hidden until they start: a line of no length would show its round cap)
    if (gridLines.length)
      timeline.add(
        gridLines,
        { x2: { from: (el: unknown) => Number((el as Element).getAttribute("x1")) }, opacity: { from: 0, duration: 120 }, duration: 900, ease: "outQuad", delay: stagger(45, { from: "last" }) },
        0,
      )
    timeline
      .add(all('[data-slot="total-revenue-chart-tick"]'), { opacity: { from: 0 }, translateX: { from: -4 }, duration: 600, ease: "outQuad", delay: stagger(45, { from: "last" }) }, 150)
      .add(all('[data-slot="total-revenue-chart-axis-label"] > span'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(60) }, 300)
    entrance.grown.forEach((_, i) => {
      if (i < start) return
      const rise = { t: 0 }
      const update = () => {
        entrance.grown[i] = rise.t
        draw()
      }
      timeline.add(rise, { t: [0, 1], duration: GROW, ease: "outExpo", onUpdate: update }, BARS_AT + (i - start) * BAR_STAGGER)
    })
    const filledAt = BARS_AT + Math.max(0, latest.current.active - start) * BAR_STAGGER + GROW * 0.45
    timeline.add(entrance.fill, { t: [0, 1], duration: FILL + 250, ease: "outCubic", onUpdate: draw }, filledAt)
    const counter = { t: 0 }
    const valueEl = valueRef.current
    const countValue = () => {
      if (valueEl) valueEl.textContent = money(latest.current.value * counter.t)
    }
    countValue()
    timeline
      .add(counter, { t: [0, 1], duration: 1400, ease: "outExpo", onUpdate: countValue }, filledAt)
      .add(all('[data-slot="chart-change-badge"]'), { opacity: { from: 0 }, scale: { from: 0.6 }, duration: 600, ease: "outBack(2)" }, filledAt + 150)
      .add(all('[data-slot="total-revenue-chart-change-label"], [data-slot="total-revenue-chart-description"]'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(120) }, filledAt + 250)
    const glint = all(`${BAR}[data-index="${latest.current.active}"] [data-slot="total-revenue-chart-glint"]`)[0]
    if (glint) timeline.add(glint, { translateY: [0, -(PLOT_HEIGHT + GLINT)], duration: 1100, ease: "inOutSine", onComplete: releaseStyles("transform") }, filledAt + FILL * 0.6)
    timeline.call(() => setLit(true), filledAt + FILL + 250)
    return () => {
      if (growing.current === entrance) growing.current = null
      entrance.grown.fill(1)
      entrance.fill.t = 1
      draw()
      if (valueEl) valueEl.textContent = latest.current.valueText
    }
  })

  // Another highlighted month drains the blue from the old bar and fills the new one (a quick hover back and forth
  // reverses from where each bar is). During the entrance the filling moves over to the new month.
  const lastActive = React.useRef(active)
  useIsomorphicLayoutEffect(() => {
    const before = lastActive.current
    lastActive.current = active
    if (before === active) return
    const els = barEls()
    const entrance = growing.current
    if (entrance && (entrance.fill.t < 1 || entrance.grown.some((t) => t < 1))) {
      drawEntrance(els, entrance, bars, active)
      return
    }
    for (const i of [before, active]) {
      const key = keys[i]
      const el = els[i]
      if (!key || !el) continue
      const to = i === active ? 1 : 0
      const from = levels.current.get(key) ?? 1 - to
      fills.current.get(key)?.cancel()
      fills.current.delete(key)
      if (reduced) {
        levels.current.set(key, to)
        drawBar(el, bars[i], 1, to)
        continue
      }
      const state = { level: from }
      const paint = () => {
        levels.current.set(key, state.level)
        // the bar as it is on screen (a new period may be sliding it)
        drawBar(el, shown.current?.get(key) ?? latest.current.bars[i], 1, state.level)
      }
      paint()
      fills.current.set(
        key,
        animate(state, {
          level: to,
          duration: to ? FILL : DRAIN,
          ease: to ? "outCubic" : "inOutQuad",
          onUpdate: paint,
          onComplete: () => fills.current.delete(key),
        }),
      )
    }
  }, [active, reduced])

  // A new period or new data slides and rescales every bar from where it is (the months before the period slide off the
  // plot's left edge); a resize redraws them at once unless it comes during a slide.
  const lastLayout = React.useRef({ key: layoutKey, width })
  const morph = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastLayout.current
    lastLayout.current = { key: layoutKey, width }
    const target = new Map(keys.map((key, i) => [key, bars[i]]))
    const from = shown.current ?? target
    shown.current = target
    if (before.key === layoutKey) return
    const els = barEls()
    const morphing = !!morph.current
    morph.current?.cancel()
    morph.current = null
    const entrance = growing.current
    if (entrance && (entrance.fill.t < 1 || entrance.grown.some((t) => t < 1))) {
      drawEntrance(els, entrance, bars, active)
      return
    }
    if (reduced || (before.width !== width && !morphing)) {
      els.forEach((el, i) => drawBar(el, bars[i], 1, level(i)))
      return
    }
    // a month that wasn't there rises from the floor
    const starts = keys.map((key, i) => from.get(key) ?? { ...bars[i], top: PLOT_HEIGHT })
    const state = { t: 0 }
    const frame = () => {
      const now = new Map<string, Bar>()
      els.forEach((el, i) => {
        const bar = lerpBar(starts[i], bars[i], state.t)
        now.set(keys[i], bar)
        drawBar(el, bar, 1, level(i))
      })
      shown.current = now
    }
    frame()
    morph.current = animate(state, {
      t: 1,
      duration: MORPH,
      ease: "outExpo",
      onUpdate: frame,
      onComplete: () => {
        morph.current = null
        shown.current = target
        els.forEach((el, i) => drawBar(el, bars[i], 1, level(i)))
      },
    })
  }, [layoutKey, reduced])
  React.useEffect(() => {
    const running = fills.current
    return () => {
      morph.current?.cancel()
      for (const animation of running.values()) animation.cancel()
    }
  }, [])

  // The months slide with their bars; new ticks fade in again.
  const lastLabels = React.useRef({ xs: bars.map((b) => b.x + b.width / 2), width, ticksKey })
  useIsomorphicLayoutEffect(() => {
    const before = lastLabels.current
    const xs = bars.map((b) => b.x + b.width / 2)
    lastLabels.current = { xs, width, ticksKey }
    if (reduced) return
    if (before.ticksKey !== ticksKey)
      animate(all('[data-slot="total-revenue-chart-tick"]'), { opacity: [0, 1], duration: 500, delay: stagger(35, { from: "last" }), ease: "outQuad", onComplete: releaseStyles("opacity") })
    if (before.width !== width) return
    all('[data-slot="total-revenue-chart-axis-label"]').forEach((label, i) => {
      const dx = (before.xs[i] ?? xs[i]) - xs[i]
      if (Math.abs(dx) < 0.01) return
      animate(label, { translateX: [dx + utils.get(label, "translateX", false), 0], duration: MORPH, ease: "outExpo", onComplete: releaseStyles("transform") })
    })
  }, [layoutKey, ticksKey, reduced])

  // The tooltip fades in by its bar and glides from bar to bar (it pops in again when it changes sides).
  const lastTip = React.useRef({ tipLeft, tipTop, flipped, tipShown })
  const tipFade = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastTip.current
    lastTip.current = { tipLeft, tipTop, flipped, tipShown }
    const el = tipRef.current
    if (!el || reduced) return
    if (before.tipShown !== tipShown) {
      tipFade.current?.cancel()
      const opacity = el.style.opacity === "" ? (tipShown ? 0 : 1) : Number(el.style.opacity)
      tipFade.current = tipShown
        ? animate(el, { opacity: [opacity, 1], scale: [0.94, 1], duration: 260, ease: "outBack(1.6)", onComplete: releaseStyles("opacity", "transform") })
        : animate(el, { opacity: [opacity, 0], duration: 160, ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
      return
    }
    if (!tipShown) return
    if (before.flipped !== flipped) {
      animate(el, { scale: [0.94, 1], duration: 250, ease: "outQuad", onComplete: releaseStyles("transform") })
      return
    }
    if (before.tipLeft === tipLeft && before.tipTop === tipTop) return
    animate(el, {
      translateX: [before.tipLeft - tipLeft + utils.get(el, "translateX", false), 0],
      translateY: [before.tipTop - tipTop + utils.get(el, "translateY", false), 0],
      duration: 400,
      ease: "outExpo",
      onComplete: releaseStyles("transform"),
    })
  }, [tipLeft, tipTop, flipped, tipShown, reduced])

  // A selection by click or key sends a glint up the bar.
  const lastSelected = React.useRef(selected)
  React.useEffect(() => {
    const before = lastSelected.current
    lastSelected.current = selected
    if (reduced || before === selected || !lit) return
    all(`${BAR}[data-index="${selected}"] [data-slot="total-revenue-chart-glint"]`).forEach((glint) =>
      animate(glint, { translateY: [0, -(PLOT_HEIGHT + GLINT)], duration: 900, delay: 150, ease: "inOutSine", onComplete: releaseStyles("transform") }),
    )
  }, [selected, reduced, lit])

  // The shine of the lit bar, while the card is on screen: the sparkles twinkle in three groups at their own pace and
  // drift up and back, the four-point stars flare now and then, and every few seconds a glint sweeps up the bar.
  // Everything starts from the Figma frame and goes back to it, so stopping (another month, off screen, reduced motion)
  // reverts to the still card.
  React.useEffect(() => {
    if (reduced || !lit || !inView || active < 0) return
    const running = new Set<JSAnimation>()
    const timers = new Set<number>()
    const later = (callback: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        callback()
      }, ms)
      timers.add(id)
    }
    const run = (animation: JSAnimation) => {
      running.add(animation)
      return animation
    }
    later(() => {
      const bar = all(`${BAR}[data-index="${active}"]`)[0]
      if (!bar) return
      const drifting = bar.querySelectorAll('[data-slot="total-revenue-chart-sparkles"]')
      if (drifting.length) run(animate(drifting, { translateY: [0, -6], duration: 4600, ease: "inOutSine", loop: true, alternate: true }))
      for (let group = 0; group < TWINKLE_GROUPS; group++) {
        const targets = bar.querySelectorAll(`[data-twinkle="${group}"]`)
        if (targets.length) run(animate(targets, { opacity: [1, 0.15], duration: utils.random(1100, 2100), delay: utils.random(0, 1500), ease: "inOutSine", loop: true, alternate: true }))
      }
      bar.querySelectorAll<SVGPathElement>('[data-slot="total-revenue-chart-flare"]').forEach((flare) => {
        const flash = () => {
          const animation = run(
            animate(flare, {
              // upright at its brightest
              opacity: [0, 0.85, 0],
              scale: [0.2, 1, 0.2],
              rotate: [-45, 45],
              duration: 1100,
              ease: "inOutSine",
              onComplete: () => {
                running.delete(animation)
                later(flash, utils.random(2600, 6400))
              },
            }),
          )
        }
        later(flash, utils.random(500, 3200))
      })
      const glint = bar.querySelector('[data-slot="total-revenue-chart-glint"]')
      const sweep = () => {
        if (glint) {
          const animation = run(
            animate(glint, {
              translateY: [0, -(PLOT_HEIGHT + GLINT)],
              duration: 1600,
              ease: "inOutSine",
              onComplete: (self) => {
                running.delete(animation)
                releaseStyles("transform")(self)
              },
            }),
          )
        }
        later(sweep, utils.random(4200, 6800))
      }
      later(sweep, utils.random(1500, 2600))
    }, SHINE_DELAY)
    return () => {
      for (const id of timers) window.clearTimeout(id)
      for (const animation of running) animation.revert()
    }
  }, [active, lit, inView, reduced, layoutKey])

  const select = (next: number) => {
    if (!n) return
    setIndex(Math.min(Math.max(next, start), n - 1))
  }
  const changePeriod = (next: string) => {
    const option = periods.find((p) => p.value === next)
    if (!option || option.value === period?.value) return
    setHovered(null)
    setPeriod(option.value)
    // a highlighted month that leaves the period hands over to the latest one
    const first = n - Math.min(n, Math.max(1, option.months))
    if (selected < first) select(n - 1)
  }
  const pointerMonth = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const box = target.getBoundingClientRect()
    // CSS zoom (the live demo scales wide demos down) scales the box but not the layout
    const zoom = box.width / (target.offsetWidth || box.width || 1) || 1
    const x = (event.clientX - box.left) / zoom
    let best = start
    for (let i = start; i < n; i++) if (Math.abs(bars[i].x + bars[i].width / 2 - x) < Math.abs(bars[best].x + bars[best].width / 2 - x)) best = i
    return best
  }
  const onMonthKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = { ArrowRight: selected + 1, ArrowDown: selected + 1, ArrowLeft: selected - 1, ArrowUp: selected - 1, Home: start, End: n - 1 }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    const index = Math.min(Math.max(next, start), n - 1)
    setHovered(null)
    select(index)
    root.current?.querySelector<HTMLButtonElement>(`[data-slot="total-revenue-chart-month"][data-index="${index}"]`)?.focus()
  }

  const describe = (i: number) => `${monthText(data[i].month, "label")}: revenue ${money(data[i].revenue)}, ${valueLabel.toLowerCase()} ${money(data[i].netCashFlow)}`
  const gridDash = fittedDash(width, 4, 4)

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full", className)} {...props}>
      <div className="flex items-center justify-between gap-20">
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <p className="typo-heading-01-semibold -my-0.5 min-w-0 flex-1 truncate py-0.5 text-fg-loud">{title}</p>
        <div className="flex shrink-0 items-center gap-3">
          <ChartMenu>
            <ChartMenuTrigger {...{ asChild: true }}>
              <ChartButton corner="rounded" aria-label={`Period: ${period?.label ?? ""}`} className="group/trigger text-fg-normal">
                <CalendarSolidIcon />
                {period?.label ?? ""}
                <ChevronDownIcon className="transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
              </ChartButton>
            </ChartMenuTrigger>
            <ChartMenuContent>
              <ChartMenuRadioGroup value={period?.value} onValueChange={changePeriod}>
                {periods.map((p) => (
                  <ChartMenuRadioItem key={p.value} value={p.value}>
                    {p.label}
                  </ChartMenuRadioItem>
                ))}
              </ChartMenuRadioGroup>
            </ChartMenuContent>
          </ChartMenu>
          <ChartButton size="icon" corner="rounded" aria-label="More options" onClick={onMoreClick}>
            <DotsHorizontalIcon />
          </ChartButton>
        </div>
      </div>

      {/* the highlighted month's net cash flow and its change from the month before */}
      <div className="flex flex-col gap-2.5">
        <p className="typo-label-03-medium -my-0.5 truncate py-0.5 text-fg-normal">{valueLabel}</p>
        <p ref={valueRef} data-slot="total-revenue-chart-value" className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
          {valueText}
        </p>
        <div className="flex h-6 items-center gap-2 whitespace-nowrap">
          {change !== undefined && <ChartChangeBadge value={change} format={whole} valueRef={changeRef} />}
          {change !== undefined && (
            <span data-slot="total-revenue-chart-change-label" className="typo-label-02-medium hug-w text-fg-normal">
              {changeLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Figma: the y labels (37px) and the plot 10px apart, the months 8px under the plot */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-2">
          {/* Figma "Y Axis Labels": spread from the plot's top to its bottom edge, left-aligned */}
          <div aria-hidden className="hug-w flex min-w-[37px] flex-col justify-between" style={{ height: PLOT_HEIGHT }}>
            {[...ticks].reverse().map((tick) => (
              <span key={tick} data-slot="total-revenue-chart-tick" className="typo-label-02-regular whitespace-nowrap text-fg-soft">
                {formatCompactCurrency(tick, { locale, currency })}
              </span>
            ))}
          </div>

          <div
            ref={plotRef}
            data-slot="total-revenue-chart-plot"
            className="relative touch-pan-y"
            style={{ height: PLOT_HEIGHT }}
            onPointerMove={(event) => setHovered(pointerMonth(event))}
            onPointerLeave={() => setHovered(null)}
            onPointerUp={(event) => {
              if (event.button === 0) select(pointerMonth(event))
            }}
          >
            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
              <defs>
                {/* the gradients run down each shape's own box */}
                <linearGradient id={`${ids}-grey`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--surface-disable)" }} />
                  <stop offset="1" style={{ stopColor: "var(--surface-soft)" }} />
                </linearGradient>
                <linearGradient id={`${ids}-grey-stroke`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#dbe2eb" stopOpacity={0.8} />
                  <stop offset="1" stopColor="#dbe2eb" stopOpacity={0.2} />
                </linearGradient>
                <linearGradient id={`${ids}-lit-lid`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--primary-blue-500)", stopOpacity: 0 }} />
                  <stop offset="1" style={{ stopColor: "var(--primary-blue-500)", stopOpacity: 0.2 }} />
                </linearGradient>
                <linearGradient id={`${ids}-lit-lid-stroke`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--primary-blue-500)", stopOpacity: 0.256 }} />
                  <stop offset="1" style={{ stopColor: "var(--primary-blue-500)", stopOpacity: 0.32 }} />
                </linearGradient>
                <linearGradient id={`${ids}-lit`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: "var(--primary-blue-50)" }} />
                  <stop offset="1" style={{ stopColor: "var(--primary-blue-500)" }} />
                </linearGradient>
                <linearGradient id={`${ids}-lit-stroke`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#367bf6" stopOpacity={0.32} />
                  <stop offset="1" stopColor="#367bf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${ids}-glint`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity={0} />
                  <stop offset="0.5" stopColor="#fff" stopOpacity={0.26} />
                  <stop offset="1" stopColor="#fff" stopOpacity={0} />
                </linearGradient>
                {/* the months before the period wait left of the plot */}
                <clipPath id={`${ids}-plot`}>
                  <rect x={0} y={-PLOT_HEIGHT} width={width} height={PLOT_HEIGHT * 2} />
                </clipPath>
              </defs>

              {/* Figma "Grid Line": Border/Soft 1.2px dashed 4/4 with round caps, drawn from the right; the bottom one a solid
                  1px #e9e9e9 line over [301, 302] */}
              {ticks.map((tick, i) => {
                const y = PLOT_HEIGHT - (ticks.length > 1 ? (i / (ticks.length - 1)) * (PLOT_HEIGHT - TOP) : 0)
                return i === 0 ? (
                  <line key={tick} x1={0} x2={width} y1={PLOT_HEIGHT - 0.5} y2={PLOT_HEIGHT - 0.5} className="stroke-[#e9e9e9]" />
                ) : (
                  <line
                    key={tick}
                    data-slot="total-revenue-chart-grid-line"
                    x1={width}
                    x2={0}
                    y1={r3(y)}
                    y2={r3(y)}
                    strokeWidth={1.2}
                    strokeLinecap="round"
                    className="stroke-border-soft"
                    {...gridDash}
                  />
                )
              })}

              <g clipPath={`url(#${ids}-plot)`}>
                {bars.map((bar, i) => {
                  const on = i === active
                  const paths: BarPaths = barPaths(bar)
                  const line = revealLine(paths.top, on ? 1 : 0)
                  return (
                    <g key={keys[i]} data-slot="total-revenue-chart-bar" data-index={i}>
                      <clipPath id={`${ids}-grey-${i}`}>
                        <rect data-part="grey-clip" x={-PLOT_WIDTH} y={-PLOT_HEIGHT} width={PLOT_WIDTH * 4} height={r3(line + PLOT_HEIGHT)} />
                      </clipPath>
                      <clipPath id={`${ids}-lit-${i}`}>
                        <rect data-part="lit-clip" x={-PLOT_WIDTH} y={r3(line)} width={PLOT_WIDTH * 4} height={r3(2 * PLOT_HEIGHT - line)} />
                      </clipPath>
                      {/* grey: Background/Disable to Soft down the lid and again down the face, a 1px #dbe2eb inside stroke
                          fading from 80% to 20% on each */}
                      <g clipPath={`url(#${ids}-grey-${i})`}>
                        <path data-part="lid" d={paths.lid} fill={`url(#${ids}-grey)`} />
                        <path data-part="greyLidStroke" d={paths.greyLidStroke} fill="none" strokeWidth={GREY_STROKE} stroke={`url(#${ids}-grey-stroke)`} />
                        <path data-part="face" d={paths.face} fill={`url(#${ids}-grey)`} />
                        <path data-part="greyFaceStroke" d={paths.greyFaceStroke} fill="none" strokeWidth={GREY_STROKE} stroke={`url(#${ids}-grey-stroke)`} />
                      </g>
                      {/* lit: a see-through blue lid (blue-500 fading in to 20%) with a blue-500 rim at 26–32%, and a
                          blue-50 to blue-500 face with a #367bf6 inside stroke at 32% fading out down its sides. The lid is
                          laid on the card's white inside the group, so the sparkles' plus-lighter has it to add to. */}
                      <g clipPath={`url(#${ids}-lit-${i})`}>
                        <path data-part="lid" d={paths.lid} className="fill-surface-white" />
                        <path data-part="lid" d={paths.lid} fill={`url(#${ids}-lit-lid)`} />
                        <path data-part="litLidStroke" d={paths.litLidStroke} fill="none" strokeWidth={LIT_STROKE} stroke={`url(#${ids}-lit-lid-stroke)`} />
                        <path data-part="face" d={paths.face} fill={`url(#${ids}-lit)`} />
                        <path data-part="litFaceStroke" d={paths.litFaceStroke} fill="none" strokeWidth={LIT_STROKE} stroke={`url(#${ids}-lit-stroke)`} />
                        {on && (
                          <>
                            <clipPath id={`${ids}-outline-${i}`}>
                              <path data-part="outline" d={paths.outline} />
                            </clipPath>
                            <Sparkles clip={`url(#${ids}-outline-${i})`} anchor={`translate(${r3(bar.x)} ${r3(paths.faceTop)})`} />
                            {/* a soft diagonal sheen, parked under the bar until it sweeps up */}
                            <g clipPath={`url(#${ids}-outline-${i})`} className="mix-blend-plus-lighter">
                              <g data-part="glint" transform={`translate(${r3(bar.x)} ${PLOT_HEIGHT})`}>
                                <g data-slot="total-revenue-chart-glint">
                                  <rect x={-24} y={20} width={BAR_WIDTH + 48} height={32} transform={`rotate(-20 ${r3(BAR_WIDTH / 2)} 36)`} fill={`url(#${ids}-glint)`} />
                                </g>
                              </g>
                            </g>
                          </>
                        )}
                      </g>
                    </g>
                  )
                })}
              </g>
            </svg>

            <div role="group" aria-label={`${title} by month`}>
              {bars.map((bar, i) => {
                if (i < start) return null
                const center = bar.x + bar.width / 2
                const half = count > 1 ? (bars[Math.min(i + 1, n - 1)].x - bar.x || bar.x - bars[i - 1].x) / 2 : width / 2
                const left = Math.max(0, center - half)
                const right = Math.min(width, center + half)
                return (
                  <button
                    key={keys[i]}
                    type="button"
                    data-slot="total-revenue-chart-month"
                    data-index={i}
                    aria-label={describe(i)}
                    aria-pressed={i === selected}
                    tabIndex={i === selected ? 0 : -1}
                    onClick={(event) => {
                      // pointers select on pointer up (where a touch drag ends); this is Enter and Space
                      if (event.detail === 0) select(i)
                    }}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(":focus-visible")) setFocused(i)
                    }}
                    onBlur={() => setFocused(null)}
                    onKeyDown={onMonthKeyDown}
                    className="absolute inset-y-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary-blue-500/40"
                    style={{ left, width: right - left }}
                  />
                )
              })}
            </div>

            {tip && (
              <div
                ref={tipRef}
                aria-hidden
                data-slot="total-revenue-chart-tooltip"
                className={cn(
                  "pointer-events-none absolute z-10 flex flex-col items-start gap-2 overflow-hidden rounded-[10px] bg-surface-loud py-2 pr-4 pl-2 whitespace-nowrap",
                  // Figma paints later effects on top; CSS paints the first shadow on top
                  "shadow-[inset_0_2px_8px_rgb(255_255_255/0.24),0_0_0_1px_var(--surface-muted),0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                  !tipShown && "opacity-0",
                )}
                style={{ left: tipLeft, top: tipTop }}
              >
                <ChartTooltipLines label={tip.date} value={tip.value} valueRef={tipValueRef} />
              </div>
            )}
            {/* the same lines with their final text, measured to place the tooltip (the visible ones change width while they count) */}
            {tip && (
              <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col items-start gap-2 whitespace-nowrap">
                <ChartTooltipLines label={tip.date} value={tip.value} />
              </span>
            )}
          </div>

          <div aria-hidden />
          {/* each month centred under its bar (Figma's labels sit in equal cells beside them) */}
          <div aria-hidden className="relative h-[30px] overflow-x-clip">
            {bars.map((bar, i) => (
              <span
                key={keys[i]}
                data-slot="total-revenue-chart-axis-label"
                className={cn("absolute top-2 transition-opacity duration-300", i < start && "opacity-0")}
                style={{ left: bar.x + bar.width / 2 }}
              >
                <span className={cn("typo-label-02-regular block -translate-x-1/2 whitespace-nowrap transition-colors duration-200", i === tipTarget ? "text-fg-loud" : "text-fg-soft")}>
                  {monthText(data[i].month, "axis")}
                </span>
              </span>
            ))}
          </div>
        </div>

        <p data-slot="total-revenue-chart-description" className="flex items-center gap-2">
          <InfoCircleLineIcon className="shrink-0 text-icon-soft" />
          <span className="typo-label-02-medium -my-0.5 min-w-0 truncate py-0.5 text-fg-normal">{descriptionText}</span>
        </p>
      </div>
    </ChartCard>
  )
}

export { sampleTotalRevenueData, TotalRevenueChart, type TotalRevenueChartProps, type TotalRevenueMonth, type TotalRevenuePeriod }
