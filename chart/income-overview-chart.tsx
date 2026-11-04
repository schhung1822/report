"use client"

import { animate, stagger, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ArrowCircleDownIcon, ArrowCircleUpIcon, ArrowUpRightIcon, DotsHorizontalIcon } from "@/components/ui/chart-icons"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from "@/lib/chart-format"
import { barTicks } from "@/lib/chart-series"
import { cn } from "@/lib/utils"

type IncomeOverviewPeriod = {
  id: string
  /** The row's label ("Q1"). */
  label: string
  amount: number
  /** The bar's hue (blue by default), so a bar can match the same item in another chart. */
  color?: IncomeOverviewColor
}

type IncomeOverviewColor = "blue" | "green" | "orange" | "purple" | "yellow"

const BAR_FILL: Record<IncomeOverviewColor, string> = {
  blue: "from-primary-blue-600/80 via-primary-blue-400/80 to-primary-blue-200/80",
  green: "from-primary-green-600/80 via-primary-green-400/80 to-primary-green-200/80",
  orange: "from-primary-orange-600/80 via-primary-orange-400/80 to-primary-orange-200/80",
  purple: "from-primary-purple-600/80 via-primary-purple-400/80 to-primary-purple-200/80",
  yellow: "from-primary-yellow-600/80 via-primary-yellow-400/80 to-primary-yellow-200/80",
}

type IncomeOverviewChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  title?: string
  /** The label over the total. */
  totalLabel?: string
  /** The big number; the sum of the periods by default. */
  total?: number
  /** The total's change against the previous year, in the badge: green and up, or red and down; null hides it. */
  change?: number | null
  /** The text after the badge. */
  changeLabel?: string
  /** The breakdown's heading and the line under it (by default it names the target). */
  breakdownTitle?: string
  breakdownDescription?: string
  /** One bar per period, top to bottom. */
  periods?: IncomeOverviewPeriod[]
  /** Each period's target: the bars are read against it, and it is the axis' last value unless a period goes past it. */
  target?: number
  /** The period shown in the value tag (an index into `periods`), or null for none. Hover and focus preview one. */
  index?: number | null
  defaultIndex?: number | null
  onIndexChange?: (index: number | null, period: IncomeOverviewPeriod | undefined) => void
  /** The button under the chart. */
  insightLabel?: string
  onInsightClick?: () => void
  /** Called by the ⋯ button. */
  onMoreClick?: () => void
  locale?: string
  currency?: string
}

// Figma geometry ("Income Overview Chart" 1473:81523)
const TRACK_HEIGHT = 30 // the "Header Cell" each bar runs in…
const ROW_GAP = 8 // …and the space between them
const LABEL_GAP = 8 // the tracks start 8px after the widest label (Figma's axis start)
const ROOM = 1.07 // the track runs 7% past the axis' last value (Figma: 100K sits 23px before the end of 351px)
const TICK_COUNT = 6
const LABEL_INSET = 4 // a label at the axis' start is left-aligned, 4px in (Figma's label padding)
const TAG_GAP = 8 // the value tag sits 8px after the bar's end, or inside it when there is no room
const BARS_AT = 450
const BAR_STAGGER = 90
const GROW = 1100
const MORPH = 700
const SHEEN = 64 // the light band that sweeps across a bar…
const PARK = SHEEN + 8 // …parked this far left of it (its slant reaches 5px further)

// The Figma card: four quarters adding up to the $189,000.00 total. On the 0–107K scale of the 351px tracks every
// bar ends where Figma draws it (within 0.4px), and the 20K–80K labels sit exactly on their values.
const sampleIncomeOverviewPeriods: IncomeOverviewPeriod[] = [
  { id: "q1", label: "Q1", amount: 76700 },
  { id: "q2", label: "Q2", amount: 39550 },
  { id: "q3", label: "Q3", amount: 32550 },
  { id: "q4", label: "Q4", amount: 40200 },
]

const round = (n: number) => Math.round(n * 1000) / 1000

/** The value tag's two parts. Rendered twice: visible (its amount counts) and as an invisible copy that is measured. */
function TagParts({ amount, share, amountRef }: { amount: string; share: string; amountRef?: React.Ref<HTMLSpanElement> }) {
  return (
    <>
      <span ref={amountRef} className="typo-label-02-semibold hug-w text-fg-loud">
        {amount}
      </span>
      <span className="typo-label-02-medium hug-w text-fg-soft">{share}</span>
    </>
  )
}

/**
 * "Income Overview Chart" from the Keitoto library: the year's total revenue with its change against last year, and
 * an income breakdown of glossy blue bars, one per quarter, each in its own track and read against an axis up to the
 * quarterly target; a "See insight" button closes the card. Hover or focus a quarter to tag its bar with the amount and
 * its share of the target (the other bars dim), click to keep the tag. Animated with anime.js: the total counts up and
 * the badge pops in, the divider opens, the bars grow from the axis' start one after another with a light band sweeping
 * across each, and the axis comes in; a new quarter slides the tag over while its amount counts and sweeps the light
 * across its bar, and new data grows or shrinks the bars from where they are.
 */
function IncomeOverviewChart({
  title = "Tổng quan",
  totalLabel = "Tổng doanh thu",
  total: totalProp,
  change = null,
  changeLabel = "so với kỳ trước",
  breakdownTitle = "Chi tiết",
  breakdownDescription,
  periods = sampleIncomeOverviewPeriods,
  target = 100000,
  index: indexProp,
  defaultIndex = null,
  onIndexChange,
  insightLabel = "",
  onInsightClick,
  onMoreClick,
  locale = "vi-VN",
  currency = "VND",
  className,
  ...props
}: IncomeOverviewChartProps) {
  const n = periods.length
  const total = totalProp ?? periods.reduce((sum, period) => sum + period.amount, 0)
  const [indexValue, setIndex] = useControllableState<number | null>({
    value: indexProp,
    defaultValue: defaultIndex,
    onChange: (next) => onIndexChange?.(next, next === null ? undefined : periods[next]),
  })
  const selected = indexValue !== null && indexValue >= 0 && indexValue < n ? Math.round(indexValue) : null
  const [hovered, setHovered] = React.useState<number | null>(null)
  const [focused, setFocused] = React.useState<number | null>(null)
  const preview = hovered ?? focused
  const active = preview !== null && preview < n ? preview : selected
  // The value tag keeps the last period it showed while it fades out.
  const [tagIndex, setTagIndex] = React.useState(active)
  if (active !== null && active !== tagIndex) setTagIndex(active)
  const tagAt = tagIndex !== null && tagIndex < n ? tagIndex : null
  const period = tagAt !== null ? periods[tagAt] : undefined

  // The axis runs from 0 to its last tick (the target, or past it when a period is), and the track 7% further.
  const largest = Math.max(0, ...periods.map((p) => p.amount))
  const ticks = React.useMemo(() => barTicks(Math.max(target, largest), TICK_COUNT), [target, largest])
  const domain = (ticks[ticks.length - 1] || 1) * ROOM
  const widths = periods.map((p) => round(Math.min(Math.max(p.amount / domain, 0), 1) * 100))
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const widthsKey = widths.join(";")
  const ticksKey = ticks.join(";")

  const money = React.useCallback((value: number) => formatCurrency(value, { locale, currency }), [locale, currency])
  const whole = React.useCallback((value: number) => formatCurrency(value, { locale, currency, maximumFractionDigits: 0 }), [locale, currency])
  const share = React.useCallback((value: number) => formatPercent(Math.round(value), { locale, maximumFractionDigits: 0 }), [locale])
  const description = breakdownDescription ?? `Theo dõi so với mục tiêu ${formatCompactCurrency(target, { locale, currency })}`
  const down = (change ?? 0) < 0

  // The value tag sits 8px after the active bar's end, centred on its track, or inside the bar's end when it would run
  // past the track. Its size is measured on an invisible copy that holds the final text.
  const [overlayRef, overlay] = useChartSize<HTMLDivElement>({ width: 351, height: 204 })
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 92, height: 14 })
  const tagWidth = sizer.width + 16
  const tagHeight = sizer.height + 12
  const barEnd = tagAt !== null ? (widths[tagAt] / 100) * overlay.width : 0
  const fits = barEnd + TAG_GAP + tagWidth <= overlay.width - TAG_GAP
  const tagLeft = Math.round(fits ? barEnd + TAG_GAP : Math.max(TAG_GAP, barEnd - TAG_GAP - tagWidth))
  const tagTop = tagAt !== null ? Math.round(tagAt * (TRACK_HEIGHT + ROW_GAP) + (TRACK_HEIGHT - tagHeight) / 2) : 0
  const tagAmount = period?.amount ?? 0
  const tagShare = target > 0 ? (tagAmount / target) * 100 : 0

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const totalRef = React.useRef<HTMLParagraphElement>(null)
  const changeRef = React.useRef<HTMLSpanElement>(null)
  const tagRef = React.useRef<HTMLDivElement>(null)
  const tagAmountRef = React.useRef<HTMLSpanElement>(null)
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])
  const totalText = money(total)
  const changeText = whole(Math.abs(change ?? 0))
  const latest = React.useRef({ total, change, totalText, changeText })
  useIsomorphicLayoutEffect(() => {
    latest.current = { total, change, totalText, changeText }
  })

  // New values count from the previous ones.
  useCountUp(totalRef, total, money, { duration: 900 })
  useCountUp(changeRef, Math.abs(change ?? 0), whole, { duration: 900 })
  useCountUp(tagAmountRef, tagAmount, whole, { duration: 500 })

  // Entrance, once the card is in view: the total counts up and the badge pops in with its amount counting, the
  // divider opens, the heading comes in, the bars grow from the axis' start one after another as their labels fade in,
  // then the axis labels and the button.
  useChartEntrance(root, (timeline) => {
    const totalEl = totalRef.current
    const changeEl = changeRef.current
    const counter = { total: 0, change: 0 }
    const count = () => {
      if (totalEl) totalEl.textContent = money(latest.current.total * counter.total)
      if (changeEl) changeEl.textContent = whole(Math.abs(latest.current.change ?? 0) * counter.change)
    }
    count()
    timeline
      .add(counter, { total: [0, 1], duration: 1400, ease: "outExpo", onUpdate: count }, 0)
      .add(all('[data-slot="income-overview-chart-badge"]'), { opacity: { from: 0 }, scale: { from: 0.85 }, duration: 600, ease: "outBack(1.7)" }, 200)
      .add(counter, { change: [0, 1], duration: 1200, ease: "outExpo", onUpdate: count }, 200)
      .add(all('[data-slot="income-overview-chart-change-label"]'), { opacity: { from: 0 }, translateX: { from: -6 }, duration: 600, ease: "outQuad" }, 300)
      .add(all('[data-slot="income-overview-chart-divider"]'), { scaleX: { from: 0 }, duration: 900, ease: "outExpo" }, 300)
      .add(all('[data-slot="income-overview-chart-heading"] > *'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 600, ease: "outQuad", delay: stagger(70) }, 350)
      .add(all('[data-slot="income-overview-chart-label"]'), { opacity: { from: 0 }, translateX: { from: -6 }, duration: 600, ease: "outQuad", delay: stagger(BAR_STAGGER) }, BARS_AT)
    all('[data-slot="income-overview-chart-bar"]').forEach((bar, i) => {
      const at = BARS_AT + i * BAR_STAGGER
      timeline.add(bar, { width: ["0%", bar.style.width || "0%"], duration: GROW, ease: "outExpo" }, at)
      // a light band sweeps across the bar as it settles
      const sheen = bar.querySelector<HTMLElement>('[data-slot="income-overview-chart-sheen"]')
      if (sheen) timeline.add(sheen, { translateX: [0, bar.offsetWidth + PARK + 8], duration: 900, ease: "inOutSine" }, at + 350)
    })
    timeline
      .add(all('[data-slot="income-overview-chart-tick"] > span'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(50) }, BARS_AT + 200)
      .add(all('[data-slot="income-overview-chart-insight"]'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 600, ease: "outQuad" }, BARS_AT + 450)
    return () => {
      if (totalEl) totalEl.textContent = latest.current.totalText
      if (changeEl) changeEl.textContent = latest.current.changeText
    }
  })

  // New data grows or shrinks every bar from the width it has on screen.
  const morphs = React.useRef<JSAnimation[]>([])
  const lastWidths = React.useRef(widthsKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastWidths.current
    lastWidths.current = widthsKey
    if (before === widthsKey || reduced) return
    morphs.current.forEach((morph) => morph.cancel())
    const previous = before.split(";").map(Number)
    morphs.current = all('[data-slot="income-overview-chart-bar"]').map((bar, i) => {
      const from = bar.style.width.endsWith("%") ? parseFloat(bar.style.width) : (previous[i] ?? 0)
      return animate(bar, { width: [`${from}%`, `${widths[i]}%`], duration: MORPH, delay: i * 40, ease: "outExpo" })
    })
  }, [widthsKey, reduced])
  React.useEffect(
    () => () => {
      morphs.current.forEach((morph) => morph.cancel())
    },
    [],
  )

  // New ticks fade their labels in again.
  const lastTicks = React.useRef(ticksKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastTicks.current
    lastTicks.current = ticksKey
    if (before === ticksKey || reduced) return
    animate(all('[data-slot="income-overview-chart-tick"] > span'), { opacity: [0, 1], translateY: [4, 0], duration: 450, delay: stagger(35), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
  }, [ticksKey, reduced])

  // The value tag pops in on its bar, slides over to a new one (or along it when the bar changes) while its amount
  // counts, and fades out when no period is shown.
  const lastTag = React.useRef<{ active: number | null; left: number; top: number }>({ active, left: tagLeft, top: tagTop })
  const fade = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastTag.current
    lastTag.current = { active, left: tagLeft, top: tagTop }
    const tag = tagRef.current
    if (!tag || reduced) return
    if ((before.active === null) !== (active === null)) {
      fade.current?.cancel()
      const opacity = tag.style.opacity === "" ? (active === null ? 1 : 0) : Number(tag.style.opacity)
      fade.current =
        active === null
          ? animate(tag, { opacity: [opacity, 0], scale: [1, 0.95], duration: 180, ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
          : animate(tag, { opacity: [opacity, 1], scale: [0.9, 1], translateX: [-6, 0], duration: 350, ease: "outBack(1.6)", onComplete: releaseStyles("opacity", "transform") })
      return
    }
    if (active === null || (before.left === tagLeft && before.top === tagTop)) return
    animate(tag, {
      translateX: [before.left - tagLeft + utils.get(tag, "translateX", false), 0],
      translateY: [before.top - tagTop + utils.get(tag, "translateY", false), 0],
      duration: 500,
      ease: "outExpo",
      onComplete: releaseStyles("transform"),
    })
  }, [active, tagLeft, tagTop, reduced])

  // A bar that becomes active gets the light band across it again.
  const lastActive = React.useRef(active)
  useIsomorphicLayoutEffect(() => {
    const before = lastActive.current
    lastActive.current = active
    if (reduced || active === null || before === active) return
    const bar = all('[data-slot="income-overview-chart-bar"]')[active]
    const sheen = bar?.querySelector<HTMLElement>('[data-slot="income-overview-chart-sheen"]')
    if (bar && sheen) animate(sheen, { translateX: [0, bar.offsetWidth + PARK + 8], duration: 800, ease: "inOutSine", onComplete: releaseStyles("transform") })
  }, [active, reduced])

  const select = (next: number) => setIndex(selected === next ? null : next)
  const onPeriodKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (event.key === "Escape") {
      if (selected !== null) setIndex(null)
      return
    }
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    all('[data-slot="income-overview-chart-period"]')[Math.min(Math.max(next, 0), n - 1)]?.focus()
  }

  const lastTick = ticks[ticks.length - 1] || 1

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full", className)} {...props}>
      <div className="flex items-center justify-between gap-4">
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <p className="typo-heading-01-semibold -my-0.5 min-w-0 truncate py-0.5 text-fg-loud">{title}</p>
        {onMoreClick ? (
          <ChartButton size="icon" corner="rounded" aria-label="Tùy chọn" onClick={onMoreClick}>
            <DotsHorizontalIcon />
          </ChartButton>
        ) : null}
      </div>

      <div className="flex flex-col items-start gap-2.5">
        <p className="typo-label-03-medium hug-w whitespace-nowrap text-fg-normal">{totalLabel}</p>
        <p ref={totalRef} className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
          {totalText}
        </p>
        {change !== null && (
          <div className="flex items-center gap-2">
            {/* Figma "Change Badge": the change in green-500 on green-500 at 12% (red when it fell) */}
            <span
              data-slot="income-overview-chart-badge"
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1.5 whitespace-nowrap",
                down ? "bg-error-500/12 text-error-500" : "bg-primary-green-500/12 text-primary-green-500",
              )}
            >
              {down ? <ArrowCircleDownIcon className="size-3 shrink-0" /> : <ArrowCircleUpIcon className="size-3 shrink-0" />}
              <span className="sr-only">{down ? "Down" : "Up"}</span>
              <span ref={changeRef} className="typo-label-01-medium hug-w">
                {changeText}
              </span>
            </span>
            <p data-slot="income-overview-chart-change-label" className="typo-label-02-medium hug-w whitespace-nowrap text-fg-normal">
              {changeLabel}
            </p>
          </div>
        )}
      </div>

      {/* Figma "Divider": 1px Border/Soft over [y - 1, y] */}
      <div aria-hidden className="relative h-0">
        <span data-slot="income-overview-chart-divider" className="absolute inset-x-0 -top-px h-px bg-border-soft" />
      </div>

      <div className="flex flex-col gap-3">
        <div data-slot="income-overview-chart-heading" className="flex flex-col gap-2">
          <p className="typo-label-03-semibold -my-0.5 truncate py-0.5 text-fg-loud">{breakdownTitle}</p>
          {description && <p className="typo-label-02-medium text-fg-normal">{description}</p>}
        </div>

        <div
          role="group"
          aria-label={breakdownTitle}
          className="grid grid-cols-[max-content_minmax(0,1fr)] gap-y-2"
          style={{ columnGap: LABEL_GAP }}
        >
          {periods.map((p, i) => {
            const on = i === active
            return (
              <button
                key={p.id}
                type="button"
                data-slot="income-overview-chart-period"
                data-active={on || undefined}
                aria-pressed={i === selected}
                aria-label={`${p.label}: ${whole(p.amount)}, ${share(target > 0 ? (p.amount / target) * 100 : 0)} so với mục tiêu ${formatCompactCurrency(target, { locale, currency })}`}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered(null)}
                onFocus={(event) => {
                  if (event.currentTarget.matches(":focus-visible")) setFocused(i)
                }}
                onBlur={() => setFocused(null)}
                onClick={() => select(i)}
                onKeyDown={(event) => onPeriodKeyDown(event, i)}
                className="group/period grid cursor-pointer grid-cols-subgrid items-center rounded-lg text-left outline-none"
                // placed explicitly: the value tag's layer shares the tracks' column
                style={{ gridColumn: "1 / span 2", gridRow: i + 1 }}
              >
                <span
                  data-slot="income-overview-chart-label"
                  className={cn("typo-label-02-regular hug-w whitespace-nowrap transition-colors duration-200", on ? "text-fg-loud" : "text-fg-soft")}
                >
                  {p.label}
                </span>
                {/* Figma "Header Cell": #fbfbfb, 8px corners, clipping the bar; its 1px Border/Soft stroke is drawn over the bar */}
                <span
                  className="relative block overflow-hidden rounded-lg bg-[#fbfbfb] group-focus-visible/period:ring-2 group-focus-visible/period:ring-primary-blue-500/40"
                  style={{ height: TRACK_HEIGHT }}
                >
                  {/* blue-600 → blue-400 → blue-200 at 80%, a white inner glow (radius 30.85) and a soft drop shadow */}
                  <span
                    data-slot="income-overview-chart-bar"
                    className={cn(
                      "absolute inset-y-0 left-0 overflow-hidden bg-linear-to-r/srgb transition-opacity duration-300",
                      BAR_FILL[p.color ?? "blue"],
                      // Figma paints later effects on top; CSS paints the first shadow on top
                      "shadow-[inset_0_0_27.8px_rgb(255_255_255/0.46),0_6.171px_11.1px_-3.085px_rgb(38_45_58/0.2)]",
                      active !== null && !on && "opacity-40",
                    )}
                    style={{ width: `${widths[i]}%` }}
                  >
                    {/* the light band, parked left of the bar until it sweeps across (not drawn in Figma) */}
                    <span data-slot="income-overview-chart-sheen" className="pointer-events-none absolute inset-y-0" style={{ left: -PARK, width: SHEEN }}>
                      <span className="absolute inset-0 -skew-x-12 bg-linear-to-r from-surface-white/0 via-surface-white/30 to-surface-white/0" />
                    </span>
                  </span>
                  {/* a kept period's track is ringed in the card's blue */}
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-0 rounded-[inherit] transition-shadow duration-200",
                      i === selected ? "shadow-[inset_0_0_0_1px_rgb(9_125_246/0.5)]" : "shadow-[inset_0_0_0_1px_var(--border-soft)]",
                    )}
                  />
                </span>
              </button>
            )
          })}

          {/* the value tag, over the tracks' column */}
          <div ref={overlayRef} aria-hidden className="pointer-events-none relative" style={{ gridColumn: 2, gridRow: `1 / span ${Math.max(1, n)}` }}>
            {period && (
              <div
                ref={tagRef}
                data-slot="income-overview-chart-tag"
                className={cn(
                  "absolute flex items-center gap-1 rounded-lg bg-surface-white px-2 py-1.5 whitespace-nowrap",
                  // Figma paints later effects on top; CSS paints the first shadow on top
                  "shadow-[0_0_0_1px_#ececec,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                  active === null && "opacity-0",
                )}
                style={{ left: tagLeft, top: tagTop }}
              >
                <TagParts amount={whole(tagAmount)} share={share(tagShare)} amountRef={tagAmountRef} />
              </div>
            )}
            {/* the same parts with their final text, measured to place the tag (the visible amount changes width while it counts) */}
            {period && (
              <span ref={sizerRef} className="invisible absolute top-0 left-0 flex items-center gap-1 whitespace-nowrap">
                <TagParts amount={whole(tagAmount)} share={share(tagShare)} />
              </span>
            )}
          </div>

          {/* Figma "X-Labels": each value centred on its place on the track, the axis' start left-aligned */}
          <div aria-hidden className="relative h-[30px]" style={{ gridColumn: 2, gridRow: Math.max(1, n) + 1 }}>
            {ticks.map((tick) => {
              const at = round((tick / (lastTick * ROOM)) * 100)
              const start = tick === ticks[0] && at === 0
              return (
                <span key={tick} data-slot="income-overview-chart-tick" className="absolute top-2" style={{ left: start ? LABEL_INSET : `${at}%` }}>
                  {/* hug-w: a whole-pixel box like Figma's, centred as a box */}
                  <span className={cn("typo-label-02-regular hug-w block whitespace-nowrap text-fg-soft", !start && "-translate-x-1/2")}>{formatNumber(tick, { locale, notation: "compact" })}</span>
                </span>
              )
            })}
          </div>
        </div>

        {insightLabel ? (
          <div data-slot="income-overview-chart-insight" className="flex">
            <ChartButton onClick={onInsightClick} className="w-full text-fg-normal">
              {insightLabel}
              <ArrowUpRightIcon />
            </ChartButton>
          </div>
        ) : null}
      </div>
    </ChartCard>
  )
}

export { IncomeOverviewChart, sampleIncomeOverviewPeriods, type IncomeOverviewChartProps, type IncomeOverviewColor, type IncomeOverviewPeriod }
