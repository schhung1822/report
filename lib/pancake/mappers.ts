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
import { type DetailEntry, type PosDataset, UNASSIGNED_STAFF, round2 } from "./dataset";
import { rangeLabel, toDmy } from "./dates";
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
      };
    })
    .filter((row) => row.totalOrders !== 0 || row.totalRevenue !== 0)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/** One row per active day of the range, in the shop's currency (peso for the Philippines report). */
export function mapFinanceDays(dataset: PosDataset, costs: ManualCostRow[]): RawDailyFinanceRow[] {
  return dataset.days
    .map(({ date, facts }) => {
      const cost = costsForAnyScope(costs, date);
      const payroll = cost.salarySaleCskh + cost.salaryOther;
      const ads = cost.adsCost > 0 ? cost.adsCost : facts.created.adsAmount;
      // The accountant's cost of goods and shipping win over the POS figures, which the Philippines POS often leaves empty.
      const estimatedCogs = cost.cogs > 0 ? cost.cogs : facts.created.capital;
      const actualCogs = cost.cogs > 0 ? cost.cogs : facts.net.capital;
      const shipping = cost.shippingCost > 0 ? cost.shippingCost : facts.created.partnerFee;
      const active =
        facts.created.totalOrderCount !== 0 || facts.created.revenue !== 0 || facts.net.revenue !== 0 || payroll > 0 || ads > 0;
      if (!active) return null;
      const row: RawDailyFinanceRow = {
        date,
        exchangeRate: exchangeRateFor(costs, date),
        estimatedRevenue: facts.created.revenue,
        // Same basis as the actual profit that utils/finance computes (revenue - provision - cogs - ads - shipping - payroll
        // - fixed - other), so the variance between the two is about returns and unconfirmed orders, not about which
        // costs were included.
        estimatedProfit: round2(
          facts.created.revenue - cost.returnProvision - estimatedCogs - ads - shipping - payroll - cost.fixedCost - cost.otherCost - cost.taxFee,
        ),
        actualRevenue: facts.net.revenue,
        cogs: actualCogs,
        ads,
        shippingFees: shipping,
        payroll,
        outsourcedServices: cost.fixedCost,
        otherCost: cost.otherCost,
        inventoryProvision: cost.returnProvision,
        taxFee: cost.taxFee,
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
export function mapManagementRows(dataset: PosDataset, costs: ManualCostRow[]): NormalizedManagementRow[] {
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
    for (const entry of entries) dayRevenue[entry.channel] += entry.facts.created.revenue;
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
      for (const track of ["estimated", "actual"] as const) {
        const accumulator = accumulators[channel][track];
        const metrics: RawChannelMetrics = {
          revenue: round2(accumulator.revenue),
          cogs: round2(accumulator.cogs),
          returnProvision: cost.returnProvision,
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
