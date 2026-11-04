import * as React from "react"

import { ArrowCircleDownIcon, ArrowCircleUpIcon } from "@/components/ui/chart-icons"
import { cn } from "@/lib/utils"

type Tone = "green" | "blue" | "purple" | "orange" | "yellow"

const TILE: Record<Tone, string> = {
  green: "bg-primary-green-500",
  blue: "bg-primary-blue-500",
  purple: "bg-primary-purple-500",
  orange: "bg-primary-orange-500",
  yellow: "bg-primary-yellow-500",
}

/** A coloured square that holds a chart's icon. */
export function ChartIconTile({
  size = 30,
  tone = "blue",
  className,
  style,
  ...props
}: React.ComponentProps<"div"> & { size?: number; tone?: Tone }) {
  return (
    <div
      data-slot="chart-icon-tile"
      className={cn("flex shrink-0 items-center justify-center rounded-lg text-fg-white [&_svg]:size-4", TILE[tone], className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    />
  )
}

/** A small colour bar or dot that names a series in a tooltip. */
export function ChartSwatch({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="chart-swatch" className={cn("inline-block shrink-0 rounded-full", className)} {...props} />
}

/** The legend dot; `--dot-ring` (a colour) sets the thin halo around it. */
export function ChartLegendDot({ size = 8, className, style, ...props }: React.ComponentProps<"span"> & { size?: number }) {
  return (
    <span
      data-slot="chart-legend-dot"
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ width: size, height: size, boxShadow: "0 0 0 2px var(--dot-ring, transparent)", ...style }}
      {...props}
    />
  )
}

/** The pill that shows a change: green with an up arrow, red with a down arrow. `format` receives the change. */
export function ChartChangeBadge({
  value,
  format,
  valueRef,
  className,
}: {
  value: number
  format: (value: number) => string
  valueRef?: React.Ref<HTMLSpanElement>
  className?: string
}) {
  const down = value < 0
  const Icon = down ? ArrowCircleDownIcon : ArrowCircleUpIcon
  return (
    <span
      data-slot="chart-change-badge"
      className={cn(
        "typo-label-02-medium inline-flex h-6 items-center gap-1 rounded-full px-2",
        down ? "bg-error-500/10 text-error-500" : "bg-primary-green-50 text-primary-green-500",
        className,
      )}
    >
      <Icon className="size-3.5" />
      <span ref={valueRef}>{format(value)}</span>
    </span>
  )
}

/** The date and the figure in a chart's tooltip. */
export function ChartTooltipLines({ label, value, valueRef }: { label: string; value: string; valueRef?: React.Ref<HTMLSpanElement> }) {
  return (
    <>
      <span className="typo-label-02-regular hug-w text-fg-soft">{label}</span>
      <span ref={valueRef} className="typo-label-03-medium hug-w text-fg-loud">
        {value}
      </span>
    </>
  )
}

type SegmentedItem = { value: string; label: string }

/** A row of mutually exclusive options (Dự tính / Thực tế…). */
export function ChartSegmentedControl({
  items,
  value,
  onValueChange,
  variant = "rounded",
  size = "fit",
  className,
  "aria-label": ariaLabel,
}: {
  items: SegmentedItem[]
  value?: string
  onValueChange?: (value: string) => void
  variant?: "rounded" | "pill"
  size?: "fit" | "full"
  className?: string
  "aria-label"?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="chart-segmented-control"
      className={cn("inline-flex gap-0.5 bg-surface-base p-0.5", variant === "pill" ? "rounded-full" : "rounded-lg", size === "full" && "w-full", className)}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onValueChange?.(item.value)}
            className={cn(
              "typo-label-02-medium h-7 px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-blue-500/40",
              variant === "pill" ? "rounded-full" : "rounded-md",
              size === "full" && "flex-1",
              active ? "bg-surface-white text-fg-loud shadow-xs" : "text-fg-soft hover:text-fg-normal",
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
