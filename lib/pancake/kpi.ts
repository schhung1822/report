/**
 * Operating indicators computed from a normalized PosDataset. Every ratio is null (shown as "—") when its denominator is
 * zero, never 0 or Infinity, so a missing figure can't be mistaken for a bad one.
 *
 * Formulas (created = orders created in the period, confirmed = orders confirmed, returned = returned, net = confirmed − returned):
 *  - Tỷ lệ hoàn (doanh thu)  = returned.revenue / confirmed.revenue        Tỷ lệ hoàn (đơn) = returned.orders / confirmed.orders
 *  - Tỷ lệ chốt đơn         = confirmed.orders / created.totalOrders        (orders created earlier but confirmed now also count)
 *  - Giá trị đơn trung bình = created.revenue / created.orders              Net = net.revenue / net.orders
 *  - Biên lợi nhuận         = net.profit / net.revenue
 *  - ROAS = net.revenue / ads        Ads/doanh thu = ads / created.revenue        Chi phí ads mỗi đơn chốt = ads / confirmed.orders
 *  - COD còn phải thu = net.cod                   Tỷ lệ thanh toán trước = transfer / (transfer + cod)
 */
import { round2, type Facts, type Metrics, type PosDataset } from "./dataset"

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null)
const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null)
/** COD still to collect. A report saved before `cod` was fetched only has `moneyToCollect`, which also holds the prepaid part. */
const codOf = (metrics: Metrics) => metrics.cod ?? metrics.moneyToCollect - metrics.transferMoney

export type Kpi = {
  netRevenue: number
  netProfit: number
  netOrders: number
  /** Percent values (0 to 100) or null. */
  returnRevenueRate: number | null
  returnOrderRate: number | null
  confirmRate: number | null
  netConversion: number | null
  averageOrderValue: number | null
  netAverageOrderValue: number | null
  margin: number | null
  ads: number
  roas: number | null
  adsShare: number | null
  adsPerConfirmedOrder: number | null
  shippingPaid: number
  outstandingCod: number
  prepaidShare: number | null
  /** Orders created but not confirmed (still pending, cancelled or removed). */
  unconfirmedOrders: number
}

export function computeKpi(facts: Facts): Kpi {
  const { created, confirmed, returned, net } = facts
  return {
    netRevenue: net.revenue,
    netProfit: net.profit,
    netOrders: net.orderCount,
    returnRevenueRate: percent(returned.revenue, confirmed.revenue),
    returnOrderRate: percent(returned.orderCount, confirmed.orderCount),
    confirmRate: percent(confirmed.orderCount, created.totalOrderCount),
    netConversion: percent(net.orderCount, created.totalOrderCount),
    averageOrderValue: ratio(created.revenue, created.orderCount),
    netAverageOrderValue: ratio(net.revenue, net.orderCount),
    margin: percent(net.profit, net.revenue),
    ads: created.adsAmount,
    roas: ratio(net.revenue, created.adsAmount),
    adsShare: percent(created.adsAmount, created.revenue),
    adsPerConfirmedOrder: ratio(created.adsAmount, confirmed.orderCount),
    shippingPaid: created.partnerFee,
    outstandingCod: codOf(net),
    prepaidShare: percent(created.transferMoney, created.transferMoney + codOf(created)),
    unconfirmedOrders: Math.max(0, created.totalOrderCount - confirmed.orderCount),
  }
}

export type ProductRow = { name: string; revenue: number; profit: number; margin: number | null }

/** Products by net revenue (confirmed minus returned) with their margin. Lines without a product name are skipped. */
export function productRows(dataset: PosDataset): ProductRow[] {
  const totals = new Map<string, { revenue: number; profit: number }>()
  for (const entry of dataset.detail) {
    if (!entry.productName) continue
    const current = totals.get(entry.productName) ?? { revenue: 0, profit: 0 }
    current.revenue += entry.facts.net.revenue
    current.profit += entry.facts.net.profit
    totals.set(entry.productName, current)
  }
  return Array.from(totals, ([name, value]) => ({
    name,
    revenue: round2(value.revenue),
    profit: round2(value.profit),
    margin: percent(value.profit, value.revenue),
  })).sort((a, b) => b.revenue - a.revenue)
}

export type SourceRow = { name: string; revenue: number; profit: number; margin: number | null }

/** Net revenue and profit per order source (Zalo, Facebook, Shopee...), biggest first. */
export function sourceRows(dataset: PosDataset): SourceRow[] {
  const totals = new Map<string, { revenue: number; profit: number }>()
  for (const entry of dataset.detail) {
    const current = totals.get(entry.sourceName) ?? { revenue: 0, profit: 0 }
    current.revenue += entry.facts.net.revenue
    current.profit += entry.facts.net.profit
    totals.set(entry.sourceName, current)
  }
  return Array.from(totals, ([name, value]) => ({
    name,
    revenue: round2(value.revenue),
    profit: round2(value.profit),
    margin: percent(value.profit, value.revenue),
  }))
    .filter((row) => row.revenue !== 0)
    .sort((a, b) => b.revenue - a.revenue)
}

export type WeekdayRow ={ weekday: number; label: string; days: number; averageRevenue: number; returnRate: number | null }

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]

/** Average created revenue and the return rate for each day of the week (Monday first). Days with no orders still count. */
export function weekdayRows(dataset: PosDataset): WeekdayRow[] {
  const groups = Array.from({ length: 7 }, () => ({ days: 0, revenue: 0, confirmed: 0, returned: 0 }))
  for (const day of dataset.days) {
    const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay()
    const group = groups[weekday]
    group.days += 1
    group.revenue += day.facts.created.revenue
    group.confirmed += day.facts.confirmed.revenue
    group.returned += day.facts.returned.revenue
  }
  return [1, 2, 3, 4, 5, 6, 0]
    .map((weekday) => ({
      weekday,
      label: WEEKDAYS[weekday],
      days: groups[weekday].days,
      averageRevenue: groups[weekday].days ? round2(groups[weekday].revenue / groups[weekday].days) : 0,
      returnRate: percent(groups[weekday].returned, groups[weekday].confirmed),
    }))
    .filter((row) => row.days > 0)
}
