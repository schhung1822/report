/**
 * Order-status view of a PosDataset: Pancake's statuses in Vietnamese, the groups the report shows them in, and the
 * bridge from "everything the POS order filter lists" to "what the report counts as revenue".
 *
 * Verified against the API: the canceled (6) and removed (7) orders are the ones the revenue figures leave out, and the POS
 * order filter lists every status except removed. The statistics API values returned orders (statuses 4, 5...) differently
 * from the POS (zero, or negative), so each row keeps both numbers: what the POS shows (`amount`) and what the revenue of
 * the report is made of (`counted`).
 */
import { round2, type PosDataset } from "./dataset"

export type StatusGroup = "waiting" | "shipping" | "done" | "returned" | "canceled"

/** In the order the report lists them: from not shipped yet to lost. */
export const STATUS_GROUPS: { id: StatusGroup; label: string; hint: string }[] = [
  { id: "waiting", label: "Chờ xử lý / chờ giao", hint: "Mới, đã xác nhận, đang đóng hàng, chờ hàng" },
  { id: "shipping", label: "Đang giao", hint: "Đã gửi cho đơn vị vận chuyển" },
  { id: "done", label: "Đã nhận", hint: "Khách đã nhận hàng" },
  { id: "returned", label: "Hoàn", hint: "Đang hoàn, đã hoàn, hoàn một phần" },
  { id: "canceled", label: "Huỷ / xoá", hint: "Không tính vào doanh thu" },
]

const STATUS_INFO: Record<string, { label: string; group: StatusGroup }> = {
  "0": { label: "Đơn mới", group: "waiting" },
  "1": { label: "Đã xác nhận", group: "waiting" },
  "8": { label: "Đang đóng hàng", group: "waiting" },
  "9": { label: "Chờ chuyển hàng", group: "waiting" },
  "11": { label: "Chờ hàng", group: "waiting" },
  "2": { label: "Đang giao", group: "shipping" },
  "3": { label: "Đã nhận", group: "done" },
  "4": { label: "Đang hoàn", group: "returned" },
  "18": { label: "Đang hoàn", group: "returned" },
  "5": { label: "Đã hoàn", group: "returned" },
  "19": { label: "Đã hoàn", group: "returned" },
  "15": { label: "Hoàn một phần", group: "returned" },
  "6": { label: "Đã huỷ", group: "canceled" },
  "7": { label: "Đã xoá", group: "canceled" },
}

const CANCELED_STATUS = "6"
/** The POS order filter hides removed orders. */
export const REMOVED_STATUS = "7"

/** A status this app has no name for still shows up (in the group of waiting orders) instead of vanishing. */
export function statusInfo(status: string) {
  return STATUS_INFO[status] ?? { label: `Trạng thái ${status}`, group: "waiting" as StatusGroup }
}

export type StatusRow = {
  status: string
  label: string
  group: StatusGroup
  orders: number
  /** What the POS shows: cash on delivery + prepaid of the orders. */
  amount: number
  prepaid: number
  cod: number
  /** The part of `amount` the report's revenue is made of (0 for canceled and removed orders). */
  counted: number
  /** False for canceled and removed orders. */
  countsAsRevenue: boolean
}

/** One row per status that has orders in the range, grouped (see STATUS_GROUPS) and then by status code. */
export function statusRows(dataset: Pick<PosDataset, "statuses">): StatusRow[] {
  const groupOrder = new Map(STATUS_GROUPS.map((group, index) => [group.id, index]))
  return (dataset.statuses ?? [])
    .map(({ status, facts, pos }): StatusRow => {
      const { label, group } = statusInfo(status)
      const { created } = facts
      const countsAsRevenue = status !== CANCELED_STATUS && status !== REMOVED_STATUS
      // Without the POS figure (removed orders, an older report, a failed read) the statistics numbers stand in.
      return {
        status,
        label,
        group,
        orders: pos ? pos.orders : created.totalOrderCount,
        amount: pos ? round2(pos.cod + pos.prepaid) : created.revenue,
        prepaid: pos ? pos.prepaid : created.transferMoney,
        cod: pos ? pos.cod : created.cod,
        counted: countsAsRevenue ? created.revenue : 0,
        countsAsRevenue,
      }
    })
    .filter((row) => row.orders !== 0 || row.amount !== 0)
    .sort((a, b) => (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0) || Number(a.status) - Number(b.status))
}

export type StatusBridge = {
  /** Every order the POS order filter lists (all statuses but removed). */
  pos: { orders: number; amount: number }
  canceled: { orders: number; amount: number }
  /** The orders that are not canceled: their POS value, and the part of it that is in the revenue. */
  remaining: { orders: number; amount: number; counted: number }
  /** Orders that are removed on the POS (the filter hides them). */
  removedOrders: number
  /**
   * POS value of the not-canceled orders minus what the revenue counts of them: the returned orders Pancake takes out (or
   * books as negative), plus rounding.
   */
  returnedAdjustment: number
  /** `net.revenue` minus the revenue of the orders created in the range: returns booked on the day they came back. */
  returnsByDate: number
  /** The revenue of the report (confirmed minus returned). */
  revenue: number
  /** The status split's revenue minus the day totals' revenue. Not zero means the two disagree. */
  gap: number
  canceledRate: number | null
}

export function statusBridge(dataset: PosDataset): StatusBridge | null {
  const rows = statusRows(dataset)
  if (!rows.length) return null
  const sum = (pick: (row: StatusRow) => boolean) =>
    rows.filter(pick).reduce(
      (acc, row) => ({ orders: acc.orders + row.orders, amount: round2(acc.amount + row.amount), counted: round2(acc.counted + row.counted) }),
      { orders: 0, amount: 0, counted: 0 },
    )
  const pos = sum((row) => row.status !== REMOVED_STATUS)
  const canceled = sum((row) => row.status === CANCELED_STATUS)
  const remaining = sum((row) => row.countsAsRevenue)
  const { created, net } = dataset.totals
  return {
    pos: { orders: pos.orders, amount: pos.amount },
    canceled: { orders: canceled.orders, amount: canceled.amount },
    remaining,
    removedOrders: sum((row) => row.status === REMOVED_STATUS).orders,
    returnedAdjustment: round2(remaining.amount - remaining.counted),
    returnsByDate: round2(net.revenue - created.revenue),
    revenue: net.revenue,
    gap: round2(remaining.counted - created.revenue),
    canceledRate: pos.orders > 0 ? (canceled.orders / pos.orders) * 100 : null,
  }
}

/** The windows (in days, ending on the report's last day) the cumulative reconciliation can look back over. */
export const RECONCILE_WINDOWS = [20, 25, 28, 30] as const
export type ReconcileWindow = (typeof RECONCILE_WINDOWS)[number]

/** Where every order of the last `windowDays` days stands now, by status. Sent by /api/pancake/reconcile. */
export type CumulativeReconciliation = {
  windowDays: ReconcileWindow
  from: string
  to: string
  fetchedAt: string
  /** The window reaches today: its newest orders are still moving. */
  includesToday: boolean
  rows: StatusRow[]
  /** Revenue and profit of each day of the window with orders or costs, in dong (pesos converted at each day's rate). */
  daily: { date: string; revenue: number; profit: number }[]
  warnings: string[]
}

export type ReconcileSummary = {
  /** Every order the POS order filter lists. */
  all: { orders: number; amount: number }
  canceled: { orders: number; amount: number }
  /** Orders created and not canceled: what the window was expected to bring in. */
  estimated: { orders: number; amount: number }
  /** The returned part of `estimated`. */
  returned: { orders: number; amount: number }
  /** `estimated` without the returned orders. */
  actual: { orders: number; amount: number }
  /** Of `actual`: already received by the customer, on the way, and not shipped yet. */
  received: { orders: number; amount: number }
  shipping: { orders: number; amount: number }
  waiting: { orders: number; amount: number }
  canceledRate: number | null
  /** Returned orders among the ones that already have an outcome (received or returned). */
  returnRate: number | null
  /** Orders still on their way (not shipped or shipping) among the not-canceled ones. */
  openRate: number | null
}

/** The amounts the POS shows, folded into the figures of the cumulative reconciliation. */
export function reconcileSummary(rows: StatusRow[]): ReconcileSummary {
  const groups = groupRows(rows)
  const of = (id: StatusGroup) => {
    const group = groups.find((item) => item.group === id)
    return { orders: group?.orders ?? 0, amount: group?.amount ?? 0 }
  }
  const [waiting, shipping, received, returned, canceled] = (["waiting", "shipping", "done", "returned", "canceled"] as const).map(of)
  const all = { orders: groups.reduce((acc, group) => acc + group.orders, 0), amount: round2(groups.reduce((acc, group) => acc + group.amount, 0)) }
  const estimated = { orders: all.orders - canceled.orders, amount: round2(all.amount - canceled.amount) }
  const actual = { orders: estimated.orders - returned.orders, amount: round2(estimated.amount - returned.amount) }
  const decided = received.orders + returned.orders
  return {
    all,
    canceled,
    estimated,
    returned,
    actual,
    received,
    shipping,
    waiting,
    canceledRate: all.orders > 0 ? (canceled.orders / all.orders) * 100 : null,
    returnRate: decided > 0 ? (returned.orders / decided) * 100 : null,
    openRate: estimated.orders > 0 ? ((waiting.orders + shipping.orders) / estimated.orders) * 100 : null,
  }
}

export type GroupRow = { group: StatusGroup; label: string; hint: string; orders: number; amount: number }

/** The status rows folded into the report's groups (empty groups left out). Amounts are what the POS shows. */
export function groupRows(rows: StatusRow[]): GroupRow[] {
  return STATUS_GROUPS.map((group) => {
    const own = rows.filter((row) => row.group === group.id && row.status !== REMOVED_STATUS)
    return {
      group: group.id,
      label: group.label,
      hint: group.hint,
      orders: own.reduce((acc, row) => acc + row.orders, 0),
      amount: round2(own.reduce((acc, row) => acc + row.amount, 0)),
    }
  }).filter((row) => row.orders !== 0 || row.amount !== 0)
}
