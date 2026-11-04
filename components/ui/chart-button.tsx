import * as React from "react"

import { cn } from "@/lib/utils"

type ChartButtonProps = React.ComponentProps<"button"> & {
  /** "icon" is a square button for a single icon. */
  size?: "default" | "icon"
  /** The shape: a pill by default, or a rounded rectangle. */
  corner?: "pill" | "rounded"
}

/** The small outlined button of the chart headers and footers. */
function ChartButton({ size = "default", corner = "pill", className, type = "button", ...props }: ChartButtonProps) {
  return (
    <button
      type={type}
      data-slot="chart-button"
      className={cn(
        "typo-label-02-medium inline-flex shrink-0 items-center justify-center gap-1.5 border border-border-soft bg-surface-white text-fg-normal shadow-xs outline-none transition-colors hover:bg-surface-base focus-visible:ring-3 focus-visible:ring-primary-blue-500/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg]:text-icon-soft",
        size === "icon" ? "size-8" : "h-8 px-3",
        corner === "pill" ? "rounded-full" : "rounded-lg",
        className,
      )}
      {...props}
    />
  )
}

export { ChartButton }
