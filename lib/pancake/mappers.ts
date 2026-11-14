/**
 * Pure report builders. They read only a normalized `PosDataset` (see dataset.ts) plus the manual cost lines.
 *
 * Every definition below is a deliberate choice; change it here and all reports follow:
 *  - "Dự tính"  = orders created in the period (`created`).
 *  - "Thực tế"  = confirmed minus returned orders (`net`).
 *  - Shipping   = `partnerFee` (carrier fee paid by the shop), not the shipping fee paid by the customer.
 *  - Costs the POS does not hold (salary, fixed cost, ads, return provision, FX rate) come from the manual cost
 *    lines, added up over every calendar day of the range; for ads the manual value wins when it is above zero,
 *    otherwise the POS `adsAmount` is used.
 */
import type { DailyReportData } from "@/lib/daily-report";
import type { RawDailyFinanceRow } from "@/types/finance";
import type { NormalizedManagementRow, ProductMetric, RawChannelMetrics } from "@/types/financial-management";
import { costsFor, costsForAnyScope, costsForDays, costsWithoutChannel, exchangeRateFor, hasAnyCost, splitByShare, staffInCosts } from "./costs";
import type { SharedPerformanceCosts } from "@/lib/performance-report";
import { type DetailEntry, type PosDataset, UNASSIGNED_STAFF, round2 } from "./dataset";
import { latestOfMonth, monthToDateRate, refundRate, type RefundTrend } from "./refund";
import { rangeLabel, toDmy } from "./dates";
import { DEFAULT_PER_ORDER_RATES, perOrderCosts, type PerOrderRates } from "./ph-order-costs";
import type { ManagementChannel, ManualCostRow } from "./types";
import { normalizeText } from "../workbook";

export { UNASSIGNED_STAFF };

export type RawPerformanceRow = {
  name: string;
  revenue: number;
  cogs: number;
  shipping: number;
  salary: number;
  fixedCost: number;
  ads: number;
};

export type RawCumulativeRow = {
  name: string;
  totalOrders: number;
  successOrders: number;
  convRate: number;
  totalRevenue: number;
  totalProfit: number;
  receivedRevenue: number;
  receivedProfit: number;
  cogs: number;
  shipping: number;
  ads: number;
};

/** Daily report (VN): money in/out of the whole range. Supplier expenses are not exposed by the POS. */
export function mapDailyReport(dataset: PosDataset): DailyReportData {
  const { created } = dataset.totals;
  return {
    reportDate: rangeLabel(dataset.range.from, dataset.range.to),
    revenue: created.revenue,
    bankTransfer: created.transferMoney,
    codReceivable: created.cod,
    shippingFee: created.partnerFee,
    expenses: [],
    series:
      dataset.days.length > 1
        ? dataset.days.map((day) => ({ date: day.date, moneyIn: day.facts.created.revenue, moneyOut: day.facts.created.partnerFee }))
        : undefined,
  };
}

/** Per-staff figures for the range. Staff named in the cost lines get a row even without orders. */
export function mapPerformanceDaily(dataset: PosDataset, costs: ManualCostRow[]): RawPerformanceRow[] {
  const dates = dataset.days.map((day) => day.date);
  const rows = new Map<string, RawPerformanceRow>();
  for (const entry of dataset.staff) {
    const existing = rows.get(entry.name);
    // Two unassigned/duplicate names would collide: add them instead of overwriting.
    rows.set(entry.name, {
      name: entry.name,
      revenue: round2((existing?.revenue ?? 0) + entry.facts.created.revenue),
      cogs: round2((existing?.cogs ?? 0) + entry.facts.created.capital),
      shipping: round2((existing?.shipping ?? 0) + entry.facts.created.partnerFee),
      salary: 0,
      fixedCost: 0,
      ads: round2((existing?.ads ?? 0) + entry.facts.created.adsAmount),
    });
  }

  const known = new Set(Array.from(rows.keys(), normalizeText));
  for (const staff of staffInCosts(costs)) {
    if (known.has(normalizeText(staff))) continue;
    if (hasAnyCost(costsForDays(costs, dates, { kind: "staff", staff }))) {
      rows.set(staff, { name: staff, revenue: 0, cogs: 0, shipping: 0, salary: 0, fixedCost: 0, ads: 0 });
    }
  }

  return Array.from(rows.values())
    .map((row) => {
      const cost = costsForDays(costs, dates, { kind: "staff", staff: row.name });
      return {
        ...row,
        salary: cost.salarySaleCskh + cost.salaryOther,
        fixedCost: cost.fixedCost + cost.otherCost,
        ads: cost.adsCost > 0 ? cost.adsCost : row.ads,
      };
    })
    .filter((row) => row.revenue !== 0 || row.cogs !== 0 || row.shipping !== 0 || row.ads !== 0 || row.salary !== 0 || row.fixedCost !== 0)
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * The salary and fixed cost of the shop that no staff member carries (the monthly totals entered for the shop, or the accountant's
 * daily sheet), over the days of the range. What staff rows already hold is taken off, so a cost typed both per person and as a
 * shop total is not counted twice.
 */
export function mapPerformanceSharedCosts(shopCosts: ManualCostRow[], staffRows: RawPerformanceRow[], dates: string[]): SharedPerformanceCosts | undefined {
  let salary = 0;
  let fixedCost = 0;
  for (const date of dates) {
    for (const row of shopCosts) {
      if (row.staff || (row.date && row.date !== date)) continue;
      salary += (row.salarySaleCskh ?? 0) + (row.salaryOther ?? 0);
      fixedCost += (row.fixedCost ?? 0) + (row.otherCost ?? 0);
    }
  }
  const shared = {
    salary: round2(Math.max(0, salary - staffRows.reduce((total, row) => total + row.salary, 0))),
    fixedCost: round2(Math.max(0, fixedCost - staffRows.reduce((total, row) => total + row.fixedCost, 0))),
  };
  return shared.salary > 0 || shared.fixedCost > 0 ? shared : undefined;
}

/** Month-to-date per staff (first of the month of the range end, up to the range end). */
export function mapPerformanceCumulative(dataset: PosDataset): RawCumulativeRow[] {
  return dataset.staffMonthToDate
    .map(({ name, facts }) => {
      const totalOrders = facts.created.totalOrderCount;
      const successOrders = Math.max(0, facts.confirmed.orderCount - facts.returned.orderCount);
      return {
        name,
        totalOrders,
        successOrders,
        convRate: totalOrders > 0 ? (successOrders / totalOrders) * 100 : 0,
        totalRevenue: facts.created.revenue,
        totalProfit: facts.created.profit,
        receivedRevenue: facts.net.revenue,
        receivedProfit: facts.net.profit,
        cogs: facts.net.capital,
        shipping: facts.net.partnerFee,
        ads: facts.net.adsAmount,
      };
    })
    .filter((row) => row.totalOrders !== 0 || row.totalRevenue !== 0)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/** The share of the returned goods the shop expects not to be able to sell again: the inventory risk provision covers this part. */
export const INVENTORY_RISK_SHARE = 0.5;

/**
 * Philippines "dự phòng rủi ro hàng tồn" of a day = cost of goods of every order that is not new or canceled (the dự tính cost of goods,
 * before returns) x refund rate x 50%. The refund rate is the month-to-date one of section IV's "Lũy kế tháng" card (monthToDateRate,
 * refund.ts); without it (a month the report has no card for, or nothing sold yet) the latest 7-day rate of the day's month, or the
 * day's own when the trend could not be read.
 */
export function inventoryRiskProvision(estimatedCogs: number, refundPercent: number | null) {
  return round2(estimatedCogs * ((refundPercent ?? 0) / 100) * INVENTORY_RISK_SHARE);
}

/** One row per active day of the range, in the shop's currency (peso for the Philippines report). */
export function mapFinanceDays(
  dataset: PosDataset,
  costs: ManualCostRow[],
  ratesOn: (date: string) => PerOrderRates = () => DEFAULT_PER_ORDER_RATES,
  /** Cost of goods worked out from the items sold per kind of goods (ph-cogs.ts); undefined for a day it cannot be worked out for. */
  cogsOn: (date: string) => { estimated: number; actual: number } | undefined = () => undefined,
  /** Products sold on a day (the base of the per-product costs); undefined when they could not be counted: orders are used then. */
  itemsOn: (date: string) => number | undefined = () => undefined,
  /** Month-to-date refund figures (refund.ts): the rate the inventory risk provision is worked out with. */
  refundTrend?: RefundTrend,
): RawDailyFinanceRow[] {
  const sheetRows = costs.filter((row) => row.fromSheet);
  return dataset.days
    .map(({ date, facts }) => {
      const cost = costsForAnyScope(costs, date);
      const typed = costsForAnyScope(sheetRows, date);
      // Outsourced services, shipping, other cost and tax/fee are a fixed amount of pesos per product sold (ph-order-costs.ts). A day
      // the accountant's sheet fills keeps the sheet's figure; any other cost line of that kind is added on top of the rate.
      const perOrder = perOrderCosts(itemsOn(date) ?? facts.confirmed.orderCount, ratesOn(date));
      const withRate = (field: "fixedCost" | "otherCost" | "taxFee" | "shippingCost", rate: number) =>
        (typed[field] ?? 0) > 0 ? cost[field] : round2(cost[field] + rate);
      const fixedCost = withRate("fixedCost", perOrder.outsourced);
      const otherCost = withRate("otherCost", perOrder.other);
      const taxFee = withRate("taxFee", perOrder.tax);
      const shippingByRate = typed.shippingCost <= 0 && cost.shippingCost <= 0;
      const shipping = typed.shippingCost > 0 ? cost.shippingCost : round2(cost.shippingCost + perOrder.shippingPedPh + perOrder.shippingPh);
      const payroll = cost.salarySaleCskh + cost.salaryOther;
      const ads = cost.adsCost > 0 ? cost.adsCost : facts.created.adsAmount;
      // The accountant's cost of goods wins; then the one worked out from the items sold per kind of goods; then the POS figure,
      // which the Philippines POS leaves empty.
      const byKind = cogsOn(date);
      const grossCogs = cost.cogs > 0 ? cost.cogs : (byKind?.estimated ?? facts.created.capital);
      const keptCogs = cost.cogs > 0 ? cost.cogs : (byKind?.actual ?? facts.net.capital);
      // The refund rate of the day: the month-to-date one of section IV's "Lũy kế tháng" card (monthToDateRate, refund.ts); without it
      // the latest 7-day rate of the day's month, or the day's own when the trend could not be read.
      const point = refundTrend ? latestOfMonth(refundTrend, date) : undefined;
      const refundPercent =
        monthToDateRate(refundTrend, date) ?? (point ? refundRate(point.confirmed, point.returned) : refundRate(facts.confirmed.revenue, Math.abs(facts.returned.revenue)));
      // The goods that come back return to stock, so their cost is not a cost of the sale: the cost of goods is multiplied by (1 - the
      // refund rate). The actual track has already left out the items that came back (keptCogs), so it only drops further when the rate is
      // above that share (recent days, whose returns have not arrived yet); a settled day is not reduced twice. A figure the accountant
      // typed is used as it is.
      const keepShare = 1 - Math.min(1, Math.max(0, (refundPercent ?? 0) / 100));
      const returnedCostShare = grossCogs > 0 ? Math.max(0, 1 - keptCogs / grossCogs) : 0;
      const estimatedCogs = cost.cogs > 0 ? grossCogs : round2(grossCogs * keepShare);
      const actualCogs = cost.cogs > 0 ? keptCogs : round2(grossCogs * Math.min(keepShare, 1 - returnedCostShare));
      const active =
        facts.created.totalOrderCount !== 0 || facts.created.revenue !== 0 || facts.net.revenue !== 0 || payroll > 0 || ads > 0;
      // The Philippines report's sales are the whole value of the orders (the POS footer's "Tổng tiền", COD + the part paid in advance).
      // Like the cost of goods, the sales are multiplied by (1 - the refund rate): part of what was sold is expected to come back. The
      // estimated track is every sale of the day. The actual track has already had the returns that arrived taken off (net), so it only
      // drops further by what the rate expects beyond them (recent days; a settled day is not reduced twice), the way the Vietnam return
      // provision works.
      const grossSales = facts.created.revenue;
      const confirmedSales = facts.confirmed.revenue;
      const returnedSales = Math.max(0, facts.returned.revenue);
      const estimatedSales = round2(grossSales * keepShare);
      const actualSales = round2(facts.net.revenue - Math.max(0, confirmedSales * (1 - keepShare) - returnedSales));
      // Inventory risk provision: a figure typed for the day (accountant's sheet, cost entries, file) wins, else the formula above, on the
      // cost of goods before the refund rate is taken off it.
      const provision = cost.returnProvision > 0 ? cost.returnProvision : inventoryRiskProvision(grossCogs, refundPercent);
      if (!active) return null;
      const row: RawDailyFinanceRow = {
        date,
        exchangeRate: exchangeRateFor(costs, date),
        estimatedRevenue: estimatedSales,
        // Same basis as the actual profit that utils/finance computes (revenue - provision - cogs - ads - shipping - payroll
        // - fixed - other), so the variance between the two is about returns and unconfirmed orders, not about which
        // costs were included.
        estimatedProfit: round2(
          estimatedSales - provision - estimatedCogs - ads - shipping - payroll - fixedCost - otherCost - taxFee,
        ),
        actualRevenue: actualSales,
        cogs: actualCogs,
        ads,
        shippingFees: shipping,
        // The two legs, only when the day's shipping is the per-product rate (a typed figure has no such split).
        ...(shippingByRate ? { shippingPedPh: perOrder.shippingPedPh, shippingPh: perOrder.shippingPh } : {}),
        payroll,
        outsourcedServices: fixedCost,
        otherCost,
        inventoryProvision: provision,
        taxFee,
        moneyInTransit: Math.max(0, facts.net.cod),
        transfer: facts.created.transferMoney,
        totalOrders: facts.confirmed.orderCount,
        refundedOrders: facts.returned.orderCount,
      };
      return row;
    })
    .filter((row): row is RawDailyFinanceRow => row !== null);
}

type OrderSource = { id: string | number; name?: string | null; parent_id?: string | number | null };

/** Decides Zalo vs Page from the order source's own name or its root source's name; everything else is Page. */
export function buildChannelResolver(sources: OrderSource[], zaloPattern = "zalo") {
  const byId = new Map(sources.map((source) => [String(source.id), source]));
  const zalo = new RegExp(zaloPattern, "i");

  const nameOf = (id: string | null) => (id === null ? "Không rõ nguồn" : byId.get(id)?.name?.trim() || `Nguồn ${id}`);
  const rootName = (id: string | null) => {
    let current = id === null ? undefined : byId.get(id);
    for (let depth = 0; current?.parent_id != null && depth < 5; depth += 1) {
      const parent = byId.get(String(current.parent_id));
      if (!parent) break;
      current = parent;
    }
    return current?.name ?? "";
  };
  const channelOf = (id: string | null): ManagementChannel =>
    zalo.test(nameOf(id)) || zalo.test(rootName(id)) ? "zalo" : "page";

  return { channelOf, nameOf };
}

type Accumulator = {
  revenue: number;
  cogs: number;
  ads: number;
  products: Map<string, { revenue: number; profit: number }>;
};

function emptyAccumulator(): Accumulator {
  return { revenue: 0, cogs: 0, ads: 0, products: new Map() };
}

function topProducts(accumulator: Accumulator, field: "revenue" | "profit"): ProductMetric[] {
  return Array.from(accumulator.products.entries())
    .map(([name, totals]) => ({ name, value: round2(totals[field]) }))
    .filter((item) => item.value !== 0)
    .sort((a, b) => b.value - a.value);
}

/**
 * Detail rows -> estimated/actual metrics per day and channel (Zalo / Page). A day is emitted when it has orders or
 * any channel cost, and then always with both channels so the report never warns about a missing one.
 */
export function mapManagementRows(
  dataset: PosDataset,
  costs: ManualCostRow[],
  /**
   * The return provision of a day as a fraction of its revenue (return-provision.ts), or undefined for none. Only for a day with no
   * provision typed. The revenue of the report is already without the orders that were returned (the POS counts a return on the
   * day the order was created), so the rate is applied to the revenue BEFORE returns (confirmed) and the returns already taken off
   * are deducted: provision = confirmed revenue x rate - returned revenue, never below 0. A settled day, whose returns all came
   * back, gets (almost) none; a recent day, whose returns are still to come, gets nearly the whole rate.
   */
  provisionRate: (date: string) => number | undefined = () => undefined,
): NormalizedManagementRow[] {
  const detailByDay = new Map<string, DetailEntry[]>();
  for (const entry of dataset.detail) detailByDay.set(entry.date, [...(detailByDay.get(entry.date) ?? []), entry]);

  const result: NormalizedManagementRow[] = [];
  for (const { date } of dataset.days) {
    const channelCosts = {
      zalo: costsFor(costs, date, { kind: "channel", channel: "zalo" }),
      page: costsFor(costs, date, { kind: "channel", channel: "page" }),
    };
    const entries = detailByDay.get(date) ?? [];
    // Lines with no channel (shop-wide, per staff) are shared out by each channel's revenue of the day; with no revenue
    // at all, equally. Estimated and actual get the same costs.
    const shared = costsWithoutChannel(costs, date);
    if (!entries.length && !hasAnyCost(channelCosts.zalo) && !hasAnyCost(channelCosts.page) && !hasAnyCost(shared)) continue;
    const dayRevenue = { zalo: 0, page: 0 };
    const grossRevenue = { zalo: 0, page: 0 };
    for (const entry of entries) {
      dayRevenue[entry.channel] += entry.facts.created.revenue;
      grossRevenue[entry.channel] += Math.max(entry.facts.confirmed.revenue, entry.facts.created.revenue);
    }
    const dayTotal = dayRevenue.zalo + dayRevenue.page;
    const [zaloShare, pageShare] = splitByShare(shared, dayTotal > 0 ? dayRevenue.zalo / dayTotal : 0.5);
    const sharedByChannel = { zalo: zaloShare, page: pageShare };

    const accumulators: Record<ManagementChannel, { estimated: Accumulator; actual: Accumulator }> = {
      zalo: { estimated: emptyAccumulator(), actual: emptyAccumulator() },
      page: { estimated: emptyAccumulator(), actual: emptyAccumulator() },
    };
    for (const entry of entries) {
      const views = { estimated: entry.facts.created, actual: entry.facts.net };
      for (const track of ["estimated", "actual"] as const) {
        const target = accumulators[entry.channel][track];
        const metrics = views[track];
        target.revenue += metrics.revenue;
        target.cogs += metrics.capital;
        target.ads += entry.facts.created.adsAmount;
        if (entry.productName) {
          const product = target.products.get(entry.productName) ?? { revenue: 0, profit: 0 };
          product.revenue += metrics.revenue;
          product.profit += metrics.profit;
          target.products.set(entry.productName, product);
        }
      }
    }

    for (const channel of ["zalo", "page"] as const) {
      const own = channelCosts[channel];
      const extra = sharedByChannel[channel];
      const cost = {
        salarySaleCskh: own.salarySaleCskh + extra.salarySaleCskh,
        salaryOther: own.salaryOther + extra.salaryOther,
        fixedCost: own.fixedCost + extra.fixedCost,
        otherCost: own.otherCost + extra.otherCost,
        adsCost: own.adsCost + extra.adsCost,
        returnProvision: own.returnProvision + extra.returnProvision,
      };
      // The goods of the returns still to come go back to the shop, so the cost of goods drops by the same share of the revenue.
      const dayRate = cost.returnProvision > 0 ? 0 : (provisionRate(date) ?? 0);
      const gross = grossRevenue[channel];
      const alreadyReturned = Math.max(0, gross - accumulators[channel].estimated.revenue);
      const pending = Math.max(0, gross * dayRate - alreadyReturned);
      const provisionOf = { estimated: pending, actual: pending };
      for (const track of ["estimated", "actual"] as const) {
        const accumulator = accumulators[channel][track];
        const provision = provisionOf[track];
        const share = accumulator.revenue > 0 ? Math.min(1, provision / accumulator.revenue) : 0;
        const metrics: RawChannelMetrics = {
          revenue: round2(accumulator.revenue),
          cogs: round2(accumulator.cogs * (1 - share)),
          returnProvision: dayRate > 0 ? round2(provision) : cost.returnProvision,
          salarySaleCskh: cost.salarySaleCskh,
          salaryOther: cost.salaryOther,
          fixedCost: cost.fixedCost,
          otherCost: cost.otherCost,
          adsCost: cost.adsCost > 0 ? cost.adsCost : round2(accumulator.ads),
          topRevenueProducts: topProducts(accumulator, "revenue"),
          topProfitProducts: topProducts(accumulator, "profit"),
        };
        result.push({ date, dateLabel: toDmy(date), track, channel, metrics });
      }
    }
  }
  return result;
}
