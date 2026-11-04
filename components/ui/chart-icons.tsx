import * as React from "react"
import {
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  CircleArrowDown,
  CircleArrowUp,
  Ellipsis,
  Info,
  TrendingUp,
  type LucideProps,
} from "lucide-react"

import { cn } from "@/lib/utils"

/** The chart kit's icons: 16px by default, coloured by the surrounding text colour. */
const make = (Icon: React.ComponentType<LucideProps>, displayName: string) => {
  function ChartIcon({ className, ...props }: LucideProps) {
    return <Icon aria-hidden="true" className={cn("size-4 shrink-0", className)} {...props} />
  }
  ChartIcon.displayName = displayName
  return ChartIcon
}

export const ArrowUpRightIcon = make(ArrowUpRight, "ArrowUpRightIcon")
export const CalendarSolidIcon = make(CalendarDays, "CalendarSolidIcon")
export const ChartBreakoutCircleIcon = make(ChartNoAxesCombined, "ChartBreakoutCircleIcon")
export const ChevronDownIcon = make(ChevronDown, "ChevronDownIcon")
export const DotsHorizontalIcon = make(Ellipsis, "DotsHorizontalIcon")
export const ArrowCircleDownIcon = make(CircleArrowDown, "ArrowCircleDownIcon")
export const ArrowCircleUpIcon = make(CircleArrowUp, "ArrowCircleUpIcon")
export const InfoCircleLineIcon = make(Info, "InfoCircleLineIcon")
export const LineChartUpIcon = make(TrendingUp, "LineChartUpIcon")
