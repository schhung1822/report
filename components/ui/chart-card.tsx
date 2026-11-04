import * as React from "react"

import { cn } from "@/lib/utils"

/** The white card every chart sits in. Takes a ref (the chart's entrance and measuring hang on it). */
function ChartCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chart-card"
      className={cn("flex flex-col gap-5 rounded-2xl border border-border-soft bg-surface-white p-5 text-fg-normal shadow-xs", className)}
      {...props}
    />
  )
}

export { ChartCard }
