import { isAdsConfigured } from "@/lib/ads/mcp-client";
import { labelsOf, listLabels, type AdsMarket } from "@/lib/ads/labels";
import { fetchLabeledSpend, type MetaSpend } from "@/lib/ads/report";
import { isMysqlConfigured } from "@/lib/costs/db";
import { listDailyCostsForReport } from "@/lib/costs/daily-repository";
import { listCogsRatesForReport } from "@/lib/costs/cogs-rates-repository";
import { getLegacyTotalsForReport } from "@/lib/costs/legacy-totals-repository";
import { listOrderRatesForReport } from "@/lib/costs/order-rates-repository";
import { addLegacyToSeries, isEmptyLegacy, type LegacyTotals } from "./legacy-totals";
import { sheetCellsToCostRows, sheetMarketOf, type SheetCell } from "@/lib/costs/daily-sheet";
import { expandCostEntries } from "@/lib/costs/expand";
import { listEntriesInRange } from "@/lib/costs/repository";
import type { CostEntry } from "@/lib/costs/types";
import { processNormalizedManagementRows } from "@/lib/financial-management";
import { latestRate, RATE_PAIR, type ExchangeRateEntry } from "@/lib/rates/rates";
import { listRates } from "@/lib/rates/repository";
import { sheetDailyFigures } from "@/lib/pnl/reconcile";
import { listPnlDays, type StoredPnlDay } from "@/lib/pnl/repository";
import { pesoToVnd } from "@/utils/finance";
import { calculateDailyRow } from "@/lib/performance-report";
import { PH_DEFAULT_EXCHANGE_RATE, processPhilippinesRows } from "@/lib/philippines-report";
import { normalizeText } from "../workbook";
import { buildCumulative, buildRefundTrend, latestOfMonth, monthToDateRate, receivedMonthPoint, refundRate, refundWindowStart, returningAmounts, RETURNING_STATUSES, type CumulativeDay, type CumulativePoint, type RefundDay, type RefundTrend, type ReturningOrder } from "./refund";
import { provisionRange, provisionRates, type ProvisionRate } from "./return-provision";
import { COGS_CATEGORIES, cogsOfDay, cogsRatesOn, quantitiesByDay, type CogsOrder, type CogsRatesEntry, type DayQuantities } from "./ph-cogs";
import { perOrderRatesOn, shippingPerOrder, type PerOrderRatesEntry } from "./ph-order-costs";
import { describeSharedPay, describeSharedTotals, isRevenueSharedPay, isRevenueSharedTotal, revenueHorizon, sharePayByRevenue } from "./ph-payroll";
import { applySheetPrecedence, costsForAnyScope, daysWithoutSheet, exchangeRateFor, hasAnyCost, staffCostsToPesos, staffWorkedOn, type SheetPrecedence } from "./costs";
import {
  addMetrics,
  buildDataset,
  sumFacts,
  factsFromBuckets,
  metricsFromBucket,
  round2,
  staffNameOf,
  UNASSIGNED_STAFF,
  zeroMetrics,
  type Facts,
  type FactRow,
  type PosDataset,
  type PosStatusTotals,
  type QueryResult,
} from "./dataset";
import { addDays, bucketUtcOffset, chunkRange, listDays, dayBoundsUtc, monthStart, rangeLabel, toDmy, todayAt } from "./dates";
import { getPancakeConfig, PancakeError, PancakeSession } from "./mcp-client";
import { carriesSharedCosts, declaredPhShopIds, mainPhShopId, usesPosCost } from "./ph-shops";
import { applyMetaAds } from "./meta-ads";
import { NEW_STATUS, REMOVED_STATUS, statusRows, type CumulativeReconciliation, type ReconcileWindow } from "./status";
import {
  buildChannelResolver,
  INVENTORY_RISK_SHARE,
  mapDailyReport,
  mapFinanceDays,
  mapManagementRows,
  mapPerformanceCumulative,
  mapPerformanceDaily,
  mapPerformanceSharedCosts,
} from "./mappers";
import type { RawDailyFinanceRow } from "@/types/finance";
import { POS_SOURCE_SHEET } from "@/types/financial-management";
import type { Bucket, ManualCostRow, OpenOrders, PancakeShop, PancakeSyncRequest, PancakeSyncResult, PreviousDay, StaffScan, StaffScanEntry } from "./types";

/** Pancake fields requested from `list_analytics_sale` (see METRIC_FIELDS in dataset.ts). */
const SALE_FIELDS = [
  "revenue",
  "profit",
  "capital",
  "partner_fee",
  "ads_amount",
  "transfer_money",
  "cod",
  "money_to_collect",
  "order_count",
  "total_order_count",
];

/** One statistics call never spans more than this many days, to keep every response small and complete. */
const MAX_CHUNK_DAYS = 31;

type Dimension = "Time.day" | "User.id" | "Order.order_sources" | "Order.status" | "Variation.product_id";

type RawShop = { id: number; name: string; currency?: string };
type RawAnalytics = {
  success?: boolean;
  data?: Record<string, unknown>[];
  summary?: Bucket | null;
  pagination?: unknown;
};
type RawEmployees = {
  data?: { id?: string; user_id?: string; user?: { id?: string; name?: string }; department?: { name?: string | null } | null }[];
};
type RawSources = { data?: { id: string | number; name?: string | null; parent_id?: string | number | null }[] };

export async function listShops(session: PancakeSession): Promise<PancakeShop[]> {
  const response = await session.callTool<{ shops?: RawShop[] }>("pos_shop", { action: "list" });
  const philippines = declaredPhShopIds();
  return (response.shops ?? []).map((shop) => ({ id: shop.id, name: shop.name, currency: philippines.has(Number(shop.id)) ? "PHP" : (shop.currency ?? "") }));
}

type ShopEntry = { shop: PancakeShop; apiKey: string };

/**
 * Lists the shops of every configured key. A shop seen under several keys keeps the first one.
 * A key that fails is reported in `problems` instead of hiding the shops of the keys that work.
 */
async function listAllShops(): Promise<{ entries: ShopEntry[]; problems: string[] }> {
  const entries = new Map<number, ShopEntry>();
  const problems: string[] = [];
  for (const { name, apiKey } of getPancakeConfig().keys) {
    try {
      for (const shop of await listShops(await PancakeSession.open(apiKey))) {
        if (!entries.has(shop.id)) entries.set(shop.id, { shop, apiKey });
      }
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : "lỗi không xác định"}`);
    }
  }
  return { entries: Array.from(entries.values()), problems };
}

/**
 * Meta ad accounts are labelled by market (PH), not by shop. With several Philippines shops the spend of those accounts is booked
 * on ONE of them, so a report that adds the shops together counts it once. That is PANCAKE_SHOP_ID_PHIL when it is a PHP shop of
 * the configured keys, else the PHP shop with the lowest id.
 */
export function phAdsShopId(shops: { id: number; currency: string }[], preferred = process.env.PANCAKE_SHOP_ID_PHIL): number | undefined {
  const ids = shops
    .filter((shop) => shop.currency.toUpperCase() === "PHP")
    .map((shop) => shop.id)
    .sort((a, b) => a - b);
  const wanted = Number(preferred);
  return ids.includes(wanted) ? wanted : ids[0];
}

function resolveShop({ entries, problems }: { entries: ShopEntry[]; problems: string[] }, requestedId: number | undefined) {
  if (!entries.length) {
    throw new PancakeError(
      problems.length ? `Không lấy được shop nào. ${problems.join(" | ")}` : "API key này không có quyền với shop nào trên Pancake POS.",
      problems.length ? 502 : 403,
    );
  }
  const wantedId = requestedId ?? (Number(process.env.PANCAKE_SHOP_ID) || undefined);
  if (wantedId) {
    const entry = entries.find((item) => item.shop.id === wantedId);
    if (!entry) throw new PancakeError(`Không tìm thấy shop ${wantedId} trong các tài khoản Pancake đã cấu hình.`, 404);
    return entry;
  }
  if (entries.length === 1) return entries[0];
  throw new PancakeError("Có nhiều shop. Hãy chọn shop cần lấy dữ liệu.", 400);
}

/** Runs one statistics query over a range, split into chunks, and normalizes every row. */
async function fetchQuery(
  session: PancakeSession,
  shop: PancakeShop,
  dimensions: Dimension[],
  range: { from: string; to: string },
  /** True for the split by status itself: it must still list the new orders so the status table can show what was left out. */
  withNewOrders = false,
): Promise<QueryResult> {
  const offset = bucketUtcOffset();
  const responses = await Promise.all(
    chunkRange(range.from, range.to, MAX_CHUNK_DAYS).map((chunk) =>
      session.callTool<RawAnalytics>("pos_statistics", {
        action: "list_analytics_sale",
        shop_id: shop.id,
        since: dayBoundsUtc(chunk.from, offset, "start"),
        until: dayBoundsUtc(chunk.to, offset, "end"),
        split_by: dimensions,
        select_fields: SALE_FIELDS,
        // New orders (status 0) are not confirmed yet, so like the canceled ones (which the statistics already leave out) they are not
        // revenue. The `_exclude` suffix negates the filter (pos_describe pos_statistics.list_analytics_sale).
        ...(withNewOrders ? {} : { filter: { "Order.status_exclude": [NEW_STATUS] } }),
        // Bucket "confirmed" orders by the day they were created, like the POS order filter. By default Pancake buckets an
        // order by the day it reached its success status, so a "waitting" order created yesterday lands on today's report
        // (verified on a VND shop: 43.617.000 by default vs 40.797.000 = the POS footer with this option).
        success_record: "inserted_at",
        // Same for returns: an order that is returned counts against the day it was CREATED, not the day the return happens
        // (by default Pancake takes returns off the day they come back, so a day's figure no longer matched the POS filter;
        // verified on the PH shop: 03/11 was 181.050 in the POS but 164.350 here, 16.700 being older orders returned that day).
        returned_record: "inserted_at",
      }),
    ),
  );

  const rows: FactRow[] = [];
  let summary = zeroMetrics();
  for (const response of responses) {
    if (!response.success) throw new PancakeError("Pancake POS không trả về được số liệu thống kê.", 502);
    // Never silently drop rows: an unsupported paged response must fail loudly rather than undercount.
    if (response.pagination) {
      throw new PancakeError("Pancake POS trả dữ liệu theo trang (chưa hỗ trợ). Hãy chọn khoảng ngày ngắn hơn.", 502);
    }
    summary = addMetrics(summary, metricsFromBucket(response.summary));
    for (const row of response.data ?? []) {
      rows.push({
        keys: Object.fromEntries(dimensions.map((dimension) => [dimension, row[dimension] == null ? null : String(row[dimension])])),
        productName: (row.product as { name?: string | null } | undefined)?.name ?? null,
        facts: factsFromBuckets(
          (row.result as Bucket | null | undefined) ?? null,
          (row.success as Bucket | null | undefined) ?? null,
          (row.returned as Bucket | null | undefined) ?? null,
        ),
      });
    }
  }
  return { rows, summary };
}

type RawOrderList = { total_entries?: number; aggs?: { cod?: { value?: number }; prepaid?: { value?: number } } };

/**
 * What the POS order filter shows for each status of the range (count, COD, prepaid), read from the order list's own
 * footer totals so it matches the POS to the dong. The statistics API values returned orders differently (0 or negative).
 * Removed orders are hidden by the POS, so they are not read.
 */
async function fetchPosStatusTotals(session: PancakeSession, shop: PancakeShop, range: { from: string; to: string }, statuses: string[]) {
  const offset = bucketUtcOffset();
  const start = Date.parse(dayBoundsUtc(range.from, offset, "start")) / 1000;
  const end = Date.parse(dayBoundsUtc(range.to, offset, "end")) / 1000;
  const totals = new Map<string, PosStatusTotals>();
  await Promise.all(
    statuses
      .filter((status) => status !== REMOVED_STATUS)
      .map(async (status) => {
        const response = await session.callTool<RawOrderList>("pos_order", {
          action: "list",
          shop_id: shop.id,
          start_date_time: start,
          end_date_time: end,
          page_size: 1,
          filter_status: [Number(status)],
          fields: ["id"],
        });
        totals.set(status, {
          orders: response.total_entries ?? 0,
          cod: round2(response.aggs?.cod?.value ?? 0),
          prepaid: round2(response.aggs?.prepaid?.value ?? 0),
        });
      }),
  );
  return totals;
}

/** The statuses whose COD is still on its way to the shop, in the order the cash-flow card lists them. */
const OPEN_ORDER_STATUSES = [
  { status: "1", label: "Đã xác nhận" },
  { status: "9", label: "Chờ chuyển hàng" },
  { status: "2", label: "Đã gửi hàng" },
] as const;
/** How far back an open order is looked for: an order older than this has long been dealt with. */
const OPEN_ORDER_LOOKBACK_DAYS = 180;

/**
 * The money in circulation: the COD of every order that is confirmed, waiting to be handed over or shipped as of now, read from the
 * order list's own footer totals (so it matches the POS). It is a balance at the time of reading, not a figure of one day.
 */
async function loadOpenOrders(session: PancakeSession, shop: PancakeShop, now: number): Promise<OpenOrders> {
  const today = todayAt(bucketUtcOffset(), now);
  const totals = await fetchPosStatusTotals(
    session,
    shop,
    { from: addDays(today, -(OPEN_ORDER_LOOKBACK_DAYS - 1)), to: today },
    OPEN_ORDER_STATUSES.map((item) => item.status),
  );
  const lines = OPEN_ORDER_STATUSES.map(({ status, label }) => ({ status, label, orders: totals.get(status)?.orders ?? 0, cod: totals.get(status)?.cod ?? 0 }));
  return {
    asOf: new Date(now).toISOString(),
    lines,
    orders: lines.reduce((sum, line) => sum + line.orders, 0),
    cod: round2(lines.reduce((sum, line) => sum + line.cod, 0)),
  };
}

/** The POS employees of the shop: every account id they can appear under on an order, mapped to the display name. */
async function loadEmployees(session: PancakeSession, shop: PancakeShop) {
  const names = new Map<string, string>();
  const employees: { name: string; department: string | null }[] = [];
  const response = await session.callTool<RawEmployees>("pos_employee", { action: "list", shop_id: shop.id });
  for (const employee of response.data ?? []) {
    const name = employee.user?.name?.trim();
    if (!name) continue;
    for (const id of [employee.user?.id, employee.user_id, employee.id]) if (id) names.set(id, name);
    employees.push({ name, department: employee.department?.name?.trim() || null });
  }
  return { names, employees };
}

async function loadStaffNames(session: PancakeSession, shop: PancakeShop) {
  try {
    return (await loadEmployees(session, shop)).names;
  } catch {
    // Names are cosmetic; fall back to short ids rather than failing the whole sync.
    return new Map<string, string>();
  }
}

function zaloPattern() {
  const configured = process.env.PANCAKE_ZALO_SOURCE_PATTERN?.trim();
  if (!configured) return "zalo";
  try {
    new RegExp(configured);
    return configured;
  } catch {
    return "zalo";
  }
}

/** Pulls every dataset the reports need for the range and normalizes it (with cross-checks). */
async function loadDataset(session: PancakeSession, shop: PancakeShop, from: string, to: string, now: number): Promise<{ dataset: PosDataset; warnings: string[] }> {
  const offset = bucketUtcOffset();
  const warnings: string[] = [];
  const monthFrom = monthStart(to);

  const [byDay, byStaff, byStaffMonth, byStaffDay, detail, byStatus, staffNames, sources] = await Promise.all([
    fetchQuery(session, shop, ["Time.day"], { from, to }),
    fetchQuery(session, shop, ["User.id"], { from, to }),
    // The month-to-date column only needs its own query when the range does not already start on the 1st.
    from === monthFrom ? Promise.resolve<QueryResult | null>(null) : fetchQuery(session, shop, ["User.id"], { from: monthFrom, to }),
    fetchQuery(session, shop, ["Time.day", "User.id"], { from, to }),
    fetchQuery(session, shop, ["Time.day", "Order.order_sources", "Variation.product_id"], { from, to }),
    fetchQuery(session, shop, ["Order.status"], { from, to }, true),
    loadStaffNames(session, shop),
    session
      .callTool<RawSources>("pos_order", { action: "list_order_source", shop_id: shop.id })
      .then((response) => response.data ?? [])
      .catch(() => {
        warnings.push("Không tải được danh sách nguồn đơn: toàn bộ đơn được tính vào kênh Page.");
        return [];
      }),
  ]);

  const statusCodes = byStatus.rows.map((row) => row.keys["Order.status"]).filter((status): status is string => status !== null);
  let posByStatus = new Map<string, PosStatusTotals>();
  try {
    posByStatus = await fetchPosStatusTotals(session, shop, { from, to }, statusCodes);
  } catch {
    warnings.push("Không đọc được số đơn theo trạng thái từ danh sách đơn POS: bảng trạng thái dùng số thống kê của Pancake, có thể lệch POS khi có đơn hoàn.");
  }

  const { channelOf, nameOf } = buildChannelResolver(sources, zaloPattern());
  const dataset = buildDataset({
    shop,
    from,
    to,
    utcOffsetHours: offset,
    includesToday: to >= todayAt(offset, now),
    fetchedAt: new Date(now).toISOString(),
    byDay,
    byStaff,
    byStaffMonth: byStaffMonth ?? byStaff,
    byStaffDay,
    detail,
    byStatus,
    posByStatus,
    staffNames,
    sourceName: nameOf,
    channelOf,
  });
  return { dataset, warnings };
}

/** Failed cross-checks become loud warnings: a report built from numbers that do not add up must not look clean. */
function checkWarnings(dataset: PosDataset) {
  const warnings: string[] = [];
  for (const check of dataset.checks.filter((item) => !item.ok)) {
    const sample = check.mismatches
      .slice(0, 3)
      .map((item) => `${item.scope} · ${item.field}: ${item.actual} thay vì ${item.expected} (lệch ${item.diff})`)
      .join("; ");
    warnings.push(`⚠ Đối soát lệch — ${check.label}. ${sample}${check.mismatches.length > 3 ? "…" : ""}`);
  }
  if (warnings.length && dataset.range.includesToday) {
    warnings.push("Khoảng ngày gồm hôm nay nên số liệu đang thay đổi giữa các lần truy vấn; hãy bấm lấy lại dữ liệu.");
  }
  return warnings;
}

/**
 * The day before the report's last day, for the "today vs yesterday" comparison. A range that contains it already holds it;
 * a one-day report reads it from the POS. A failure only means the comparison is not shown.
 */
async function loadPreviousDay(session: PancakeSession, shop: PancakeShop, dataset: PosDataset): Promise<PreviousDay | undefined> {
  const date = addDays(dataset.range.to, -1);
  try {
    const known = dataset.days.find((day) => day.date === date);
    const facts = known ? known.facts : sumFacts((await fetchQuery(session, shop, ["Time.day"], { from: date, to: date })).rows.map((row) => row.facts));
    // Only the Philippines report reads this; its sales are the whole value of the orders ("Tổng tiền").
    return { date, revenue: facts.net.revenue, orders: facts.confirmed.orderCount, refunded: facts.returned.orderCount };
  } catch {
    return undefined;
  }
}

/**
 * Why the report's revenue is below the POS order filter: the filter counts every order created in the range that is not
 * canceled, while the report also takes off those of them that were returned (a return counts against the day the order was
 * created, so a past day's figure drops as its orders come back).
 */
function describeReturns(dataset: PosDataset, currency: string) {
  const { confirmed, returned, net } = dataset.totals;
  if (!returned.revenue && !returned.orderCount) return [];
  const unit = currency === "PHP" ? "₱" : "₫";
  // Both reports count the whole value of the orders as sales (the POS footer's "Tổng tiền").
  const sales = (metrics: { revenue: number }) => metrics.revenue;
  const amount = (value: number) => `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)} ${unit}`;
  return [
    `Đối chiếu doanh số với POS: đơn tạo trong kỳ, không tính đơn huỷ và đơn mới ${amount(sales(confirmed))} (${confirmed.orderCount} đơn, khớp bộ lọc POS khi bỏ hai trạng thái đó) − hoàn ${amount(sales(returned))} (${returned.orderCount} đơn trong số đó đã bị hoàn, tính vào ngày tạo đơn nên số các ngày trước sẽ giảm dần khi có đơn hoàn về) = ${amount(sales(net))} doanh số sau hoàn${currency === "PHP" ? " (báo cáo còn trừ thêm phần hoàn dự kiến theo tỷ lệ hoàn lũy kế tháng, xem ghi chú về tỷ lệ hoàn bên dưới)" : ""}.`,
  ];
}

function hasAmount(row: ManualCostRow) {
  return row.salarySaleCskh + row.salaryOther + row.fixedCost + row.otherCost + row.adsCost + row.returnProvision > 0;
}

/**
 * Rows keep a rate typed in the cost file for that exact day; every other day gets the LATEST stored rate that is
 * already in effect (not one that starts in the future).
 */
function applyHouseRate(phRows: RawDailyFinanceRow[], rates: ExchangeRateEntry[] | null, today: string) {
  const latest = rates ? latestRate(rates, today) : null;
  const warnings: string[] = [];
  const ownRate = phRows.filter((row) => row.exchangeRate).length;
  if (latest) {
    for (const row of phRows) if (!row.exchangeRate) row.exchangeRate = latest.rate;
    warnings.push(`Tỷ giá áp dụng: 1 ${RATE_PAIR.from} = ${latest.rate} ${RATE_PAIR.to} (mới nhất, hiệu lực từ ${toDmy(latest.effectiveDate)}).`);
    if (ownRate) warnings.push(`${ownRate} ngày dùng tỷ giá riêng ghi trong file chi phí thay cho tỷ giá mới nhất.`);
  } else if (rates === null) {
    warnings.push("Chưa cấu hình MySQL: tỷ giá lấy từ file chi phí hoặc ô tỷ giá mặc định trên trang.");
  } else if (!rates.length) {
    warnings.push("MySQL chưa có tỷ giá nào (trang Tỷ giá): đang dùng tỷ giá mặc định trên trang (chỉnh được).");
  } else {
    warnings.push("Mọi tỷ giá trong MySQL đều có hiệu lực từ sau hôm nay nên chưa dùng được: đang dùng tỷ giá mặc định trên trang.");
  }
  if (!latest && !ownRate && phRows.length) warnings.push("Chưa có tỷ giá cho các ngày trong báo cáo: dùng tỷ giá mặc định trên trang (chỉnh được).");
  return { warnings, latest: latest ? { rate: latest.rate, effectiveDate: latest.effectiveDate } : null };
}

function philippinesReports(
  dataset: PosDataset,
  costs: ManualCostRow[],
  rates: ExchangeRateEntry[] | null,
  today: string,
  orderRates: PerOrderRatesEntry[],
  cogs: CategoryCogs | null,
  sold: SoldItems | null,
  /** Another Philippines shop carries the Meta ad spend, so this one having no ads is expected. */
  adsOnOtherShop = false,
  /** Month-to-date refund figures: the rate the inventory risk provision is worked out with. */
  refundTrend?: RefundTrend,
  /** The cost of goods is the cost of each product in the POS (ph-shops.ts posCostShopIds). */
  posCost = false,
) {
  const phRows = mapFinanceDays(dataset, costs, (date) => perOrderRatesOn(orderRates, date), cogs?.onDay, sold?.itemsOn, refundTrend);
  const rate = applyHouseRate(phRows, rates, today);
  const dates = dataset.days.map((day) => day.date);
  const warnings: string[] = [];
  if (!phRows.length) warnings.push("Pancake POS chưa có đơn nào trong khoảng ngày này.");
  else {
    const { created, net } = dataset.totals;
    const peso = (value: number) => `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)} ₱`;
    warnings.push(
      `Doanh thu bán hàng tính theo tổng tiền của đơn (gồm cả phần khách trả trước), như ô “Tổng tiền” cuối bảng đơn của POS: đơn tạo trong kỳ ${peso(created.revenue)} tổng tiền (${peso(created.revenue - created.transferMoney)} COD + ${peso(created.transferMoney)} trả trước); doanh thu thực tế sau hoàn ${peso(net.revenue)} (khớp ô “Tổng tiền” của POS khi chưa có đơn hoàn), trước khi nhân với (1 − tỷ lệ hoàn).`,
    );
  }
  if (!phRows.some((row) => Number(row.payroll) > 0)) {
    warnings.push("Chưa có chi phí lương trong khoảng ngày này (trang Chi phí cố định hoặc file chi phí): đang tính lương = 0.");
  }
  if (!adsOnOtherShop && !phRows.some((row) => Number(row.ads) > 0)) {
    warnings.push("Chi phí ads = 0: POS chưa ghi nhận ads. Hãy nhập chi phí marketing hoặc chọn tài khoản Ads Meta ở mục “Chi phí & tuỳ chọn”.");
  }
  // Dịch vụ mua ngoài, giao hàng, chi phí khác và thuế/phí are a per-product rate; the Philippines POS holds no cost of goods, so a
  // day that sold something without it shows too high a profit.
  if (phRows.length) {
    const last = perOrderRatesOn(orderRates, dataset.range.to);
    const changed = dates.some((date) => JSON.stringify(perOrderRatesOn(orderRates, date)) !== JSON.stringify(last));
    warnings.push(
      `Chi phí tính theo số sản phẩm bán ra của ngày${sold ? ` (${sold.total} sản phẩm trong ${dates.length} ngày)` : ""}${changed ? " (đơn giá có đổi trong kỳ, mỗi ngày dùng đơn giá có hiệu lực của ngày đó; đây là đơn giá ngày cuối)" : ""}: dịch vụ mua ngoài ${last.outsourced} ₱, giao hàng ${shippingPerOrder(last)} ₱ (PED → Phi ${last.shippingPedPh} + bên Phi ${last.shippingPh}), chi phí khác ${last.other} ₱, thuế/phí ${last.tax} ₱ mỗi sản phẩm${orderRates.length ? "" : " (mức mặc định, chưa lưu đơn giá nào ở trang Chi phí cố định)"}. Ngày nào kế toán đã nhập số riêng thì dùng số đó.`,
    );
    if (sold?.warning) warnings.push(sold.warning);
    else if (!sold) warnings.push("⚠ Không đếm được số sản phẩm từ danh sách đơn POS nên các chi phí trên đang tính theo số đơn (mỗi đơn coi như 1 sản phẩm).");
  }
  if (cogs) warnings.push(...cogs.notes);
  if (phRows.length) {
    const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
    const typedDays = dates.filter((date) => costsForAnyScope(costs, date).returnProvision > 0).length;
    const lastDate = dates[dates.length - 1];
    const point = refundTrend ? latestOfMonth(refundTrend, lastDate) : undefined;
    const monthPercent = monthToDateRate(refundTrend, lastDate);
    const percent = monthPercent ?? (point ? refundRate(point.confirmed, point.returned) : null);
    warnings.push(
      `Dự phòng rủi ro hàng tồn (tự tính) = giá vốn dự tính của mọi đơn trừ đơn mới và đơn huỷ × tỷ lệ hoàn × ${INVENTORY_RISK_SHARE * 100}%: tổng ${money.format(phRows.reduce((sum, row) => sum + Number(row.inventoryProvision ?? 0), 0))} ₱${
        percent === null ? "" : `, tỷ lệ hoàn đang dùng ${money.format(percent)}% (${monthPercent !== null ? "lũy kế từ đầu tháng, giống thẻ “Lũy kế tháng” ở mục IV" : "7 ngày gần nhất của tháng, vì chưa có thẻ lũy kế tháng"})`
      }.${typedDays ? ` ${typedDays} ngày đã nhập dự phòng riêng nên dùng số nhập tay.` : " Ngày nào nhập dự phòng riêng thì dùng số nhập tay."}`,
    );
  }
  if (phRows.length) {
    const lastDate = dates[dates.length - 1];
    const point = refundTrend ? latestOfMonth(refundTrend, lastDate) : undefined;
    const percent = monthToDateRate(refundTrend, lastDate) ?? (point ? refundRate(point.confirmed, point.returned) : null);
    if (percent !== null) {
      warnings.push(
        `Doanh số bán hàng và giá vốn tự tính (theo danh mục hoặc của POS) được nhân với (1 − tỷ lệ hoàn ${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(percent)}% lũy kế tháng) vì hàng hoàn không phải doanh số và hàng về kho không phải giá vốn của đơn bán. Ngày nào đã có đơn hoàn thực tế nhiều hơn tỷ lệ này thì giữ số thực tế (không trừ hai lần); giá vốn kế toán nhập riêng cho ngày nào thì dùng đúng số đó. Dự phòng rủi ro hàng tồn vẫn tính trên giá vốn trước khi nhân.`,
      );
    }
  }
  if (posCost && phRows.length) {
    warnings.push("Giá vốn của shop này lấy theo giá vốn của từng sản phẩm trong POS (không dùng giá vốn trung bình theo danh mục).");
  }
  const selling = phRows.filter((row) => Number(row.estimatedRevenue) > 0);
  for (const [label, missing] of [["giá vốn", selling.filter((row) => !(Number(row.cogs) > 0))]] as const) {
    if (!missing.length) continue;
    const days = missing.slice(0, 4).map((row) => toDmy(String(row.date)));
    warnings.push(
      `⚠ Thiếu ${label} của ${missing.length}/${selling.length} ngày có doanh thu (${days.join(", ")}${missing.length > 4 ? "…" : ""}): lợi nhuận các ngày này đang cao hơn thực tế. ${
        posCost
          ? "Sản phẩm của các đơn này chưa có giá nhập trong POS: nhập giá nhập cho sản phẩm trên Pancake, hoặc nhập giá vốn từng ngày (tab “Chi phí theo ngày”) ở trang Chi phí cố định."
          : "Nhập giá vốn trung bình theo danh mục (tab “Giá vốn theo danh mục”) hoặc giá vốn từng ngày (tab “Chi phí theo ngày”) ở trang Chi phí cố định."
      }`,
    );
  }
  warnings.push(...rate.warnings);
  const scopedLines = costs.some((row) => (row.channel || row.staff) && hasAmount(row) && (!row.date || dates.includes(row.date)));
  if (scopedLines) warnings.push("Báo cáo Philippines chỉ có một bộ phận nên chi phí theo Kênh/Nhân sự cũng được cộng vào chi phí chung.");
  return { phRows, exchangeRate: rate.latest, warnings };
}

function vietnamReports(
  dataset: PosDataset,
  { staff: staffCosts, shop: costs }: { staff: ManualCostRow[]; shop: ManualCostRow[] },
  provision: Map<string, ProvisionRate> | null = null,
) {
  const dates = dataset.days.map((day) => day.date);
  const warnings: string[] = [];

  const daily = mapDailyReport(dataset);
  if (dataset.totals.created.totalOrderCount === 0) warnings.push(`Pancake POS không có đơn nào trong ${rangeLabel(dataset.range.from, dataset.range.to)}.`);

  const rawPerformance = mapPerformanceDaily(dataset, staffCosts);
  const performanceRows = rawPerformance.map(calculateDailyRow);
  const sharedCosts = mapPerformanceSharedCosts(costs, rawPerformance, dates);
  const performance = {
    dailyRows: performanceRows,
    cumulativeRows: mapPerformanceCumulative(dataset),
    reportDate: daily.reportDate,
    ...(sharedCosts ? { sharedCosts } : {}),
  };

  // The report shows the whole shop, so the Zalo/Page split of the costs only exists inside the model and adds up to the same total.
  const scopedLines = costs.some((row) => (row.channel || row.staff) && hasAmount(row) && (!row.date || dates.includes(row.date)));
  if (scopedLines) warnings.push("Báo cáo quản trị Việt Nam tính toàn shop (Zalo và Page gộp một) nên chi phí theo Kênh/Nhân sự cũng được cộng vào chi phí chung.");

  const managementRows = mapManagementRows(dataset, costs, (date) => provision?.get(date)?.rate);
  let vn: PancakeSyncResult["vn"];
  if (managementRows.length) {
    vn = processNormalizedManagementRows(managementRows, POS_SOURCE_SHEET);
    if (!dates.some((date) => hasAnyCost(costsForAnyScope(costs, date)))) {
      warnings.push("Báo cáo quản trị: chưa có lương/định phí/ads trong file chi phí nên đang bằng 0.");
    }
  } else {
    warnings.push("Pancake POS chưa có đơn nào trong khoảng ngày này nên chưa tạo được báo cáo quản trị.");
  }

  if (!sharedCosts && !performanceRows.some((row) => row.salary > 0 || row.fixedCost > 0)) {
    warnings.push("Báo cáo hiệu suất: chưa có lương/định phí theo nhân sự (dòng chi phí có cột Nhân sự) nên đang bằng 0.");
  }
  if (performanceRows.some((row) => row.name === UNASSIGNED_STAFF)) {
    warnings.push("Có đơn chưa được gán nhân sự trong POS, đang gom vào dòng “Chưa gán nhân sự”.");
  }
  warnings.push("Báo cáo ngày: danh sách khoản chi NCC không có trong POS nên để trống.");
  return { daily, performance, vn, warnings };
}

export type SyncDeps = {
  /**
   * The Meta ad spend of the accounts labelled for a market (null when there is nothing to read: no Ads MCP, no
   * database or no labelled account). Tests inject a fake.
   */
  loadMetaSpend?: (market: AdsMarket, from: string, to: string) => Promise<MetaSpend | null>;
  /** Stored cost entries overlapping the range, or null when no database is configured. */
  loadCostEntries?: (shopId: number, from: string, to: string) => Promise<CostEntry[] | null>;
  /** The accountant's daily cost sheet of the range (empty when there is none or no database is configured). */
  loadDailyCosts?: (shopId: number, from: string, to: string) => Promise<SheetCell[]>;
  /** The per-order cost rates saved for a shop (empty when none or no database is configured: the defaults apply). Tests inject a fake. */
  loadOrderRates?: (shopId: number) => Promise<PerOrderRatesEntry[]>;
  /** The average costs of goods per kind of goods saved for a shop (empty when none or no database is configured). Tests inject a fake. */
  loadCogsRates?: (shopId: number) => Promise<CogsRatesEntry[]>;
  /** Stored exchange-rate history, or null when no database is configured. */
  loadExchangeRates?: () => Promise<ExchangeRateEntry[] | null>;
  /** The days the profit sheet keeps (empty when there is none or no database is configured). Tests inject a fake. */
  loadPnlDays?: (shopId: number, from: string, to: string) => Promise<StoredPnlDay[]>;
  /** The totals of the Philippines shop that no longer sells (null when none or no database is configured). Tests inject a fake. */
  loadLegacyTotals?: (shopId: number) => Promise<LegacyTotals | null>;
  /** Clock in milliseconds; tests inject a fixed one. */
  now?: () => number;
};

const defaultLoadLegacyTotals: NonNullable<SyncDeps["loadLegacyTotals"]> = async (shopId) => (isMysqlConfigured() ? getLegacyTotalsForReport(shopId) : null);

const defaultLoadCostEntries: NonNullable<SyncDeps["loadCostEntries"]> = async (shopId, from, to) =>
  isMysqlConfigured() ? listEntriesInRange(shopId, from, to) : null;

const defaultLoadDailyCosts: NonNullable<SyncDeps["loadDailyCosts"]> = async (shopId, from, to) =>
  isMysqlConfigured() ? listDailyCostsForReport(shopId, from, to) : [];

const defaultLoadOrderRates: NonNullable<SyncDeps["loadOrderRates"]> = async (shopId) => (isMysqlConfigured() ? listOrderRatesForReport(shopId) : []);

const defaultLoadCogsRates: NonNullable<SyncDeps["loadCogsRates"]> = async (shopId) => (isMysqlConfigured() ? listCogsRatesForReport(shopId) : []);

const defaultLoadMetaSpend: NonNullable<SyncDeps["loadMetaSpend"]> = async (market, from, to) => {
  if (!isAdsConfigured() || !isMysqlConfigured()) return null;
  const labels = labelsOf(await listLabels(), market);
  return labels.length ? fetchLabeledSpend(labels, from, to) : null;
};

const defaultLoadPnlDays: NonNullable<SyncDeps["loadPnlDays"]> = async (shopId, from, to) =>
  isMysqlConfigured() ? listPnlDays(shopId, from, to) : [];

const defaultLoadExchangeRates: NonNullable<SyncDeps["loadExchangeRates"]> = async () =>
  isMysqlConfigured() ? listRates(RATE_PAIR.from, RATE_PAIR.to) : null;

/**
 * The Philippines staff pay in pesos, shared out by the revenue of the month (lib/pancake/ph-payroll.ts). That needs the revenue of
 * the month's days outside the report's range too: the days before it, and the days after it up to yesterday (or the month's end).
 */
async function sharedPayCosts(
  session: PancakeSession,
  shop: PancakeShop,
  dataset: PosDataset,
  entries: CostEntry[],
  dongPerPeso: (date: string) => number,
  today: string,
  /** The sales the pay is shared by: the revenue (whole value of the orders) of the day. */
  salesOf: (facts: Facts) => number,
) {
  const revenue = new Map(dataset.days.map((day) => [day.date, salesOf(day.facts)]));
  const { from, to } = dataset.range;
  const asOf = addDays(today, -1);
  const missing: { from: string; to: string }[] = [];
  const first = monthStart(from);
  if (first < from) missing.push({ from: first, to: addDays(from, -1) });
  const last = revenueHorizon(to, asOf);
  if (last > to) missing.push({ from: addDays(to, 1), to: last });
  for (const range of missing) {
    const result = await fetchQuery(session, shop, ["Time.day"], range);
    for (const row of result.rows) {
      const date = row.keys["Time.day"];
      if (date) revenue.set(date, (revenue.get(date) ?? 0) + salesOf(row.facts));
    }
  }
  return sharePayByRevenue(entries, listDays(from, to), (date) => revenue.get(date) ?? 0, dongPerPeso, asOf);
}

/**
 * 7-day refund figures per day (refund.ts), which need the 6 days before the first day shown too. A failure only hides
 * the trend: the report falls back to the refund rate of each day.
 */
async function loadRefundTrend(session: PancakeSession, shop: PancakeShop, dataset: PosDataset, today: string, legacy: LegacyTotals | null = null) {
  const { from, to } = dataset.range;
  const start = refundWindowStart(from, to);
  try {
    const figures = new Map<string, CumulativeDay>();
    const zero = (): CumulativeDay => ({ confirmed: 0, returned: 0, orders: 0, refunded: 0, revenue: 0 });
    const add = (date: string, facts: Facts) => {
      const before = figures.get(date) ?? zero();
      figures.set(date, {
        confirmed: before.confirmed + facts.confirmed.revenue,
        returned: before.returned + Math.abs(facts.returned.revenue),
        orders: before.orders + facts.confirmed.orderCount,
        refunded: before.refunded + facts.returned.orderCount,
        revenue: before.revenue + facts.net.revenue,
      });
    };
    const addReturning = (orders: ReturningOrder[]) => {
      // The statistics only count status 5 (returned) as returned. Orders being returned or partly returned are refunds too.
      for (const { date, amount } of returningAmounts(orders, bucketUtcOffset())) {
        const before = figures.get(date) ?? zero();
        figures.set(date, { ...before, returned: before.returned + amount, refunded: before.refunded + 1 });
      }
    };
    for (const day of dataset.days) add(day.date, day.facts);
    if (start < from) {
      for (const row of (await fetchQuery(session, shop, ["Time.day"], { from: start, to: addDays(from, -1) })).rows) {
        const date = row.keys["Time.day"];
        if (date) add(date, row.facts);
      }
    }
    addReturning(await fetchReturningOrders(session, shop, { from: start, to }));
    const trend = buildRefundTrend(start, from, to, (date) => figures.get(date));

    // The whole-history and month-to-date figures need the days before the window too. Without them (the history cannot be read)
    // the report keeps the 7-day figures.
    try {
      const since = refundHistoryStart(today);
      const historyEnd = addDays(start, -1);
      if (since <= historyEnd) {
        for (const row of (await fetchQuery(session, shop, ["Time.day"], { from: since, to: historyEnd })).rows) {
          const date = row.keys["Time.day"];
          if (date) add(date, row.facts);
        }
        addReturning(await fetchReturningOrders(session, shop, { from: since, to: historyEnd }));
      }
      trend.cumulative = buildCumulative(since, to, (date) => figures.get(date));
      // The old shop that no longer sells is part of the accountant's whole-history figures (legacy-totals.ts).
      if (legacy && !isEmptyLegacy(legacy)) {
        trend.cumulative.all = addLegacyToSeries(trend.cumulative.all, legacy);
        trend.cumulative.legacy = { label: legacy.label };
      }
      try {
        trend.cumulative.month = await receivedMonthSeries(session, shop, trend.cumulative.month, to);
        trend.cumulative.monthBasis = "received";
      } catch {
        /* the month stays on every confirmed order */
      }
    } catch {
      /* the 7-day figures stand on their own */
    }
    return trend;
  } catch {
    return undefined;
  }
}

/**
 * The month-to-date points of the last day and the day before it (when that is in the same month), read the accountant's way
 * (receivedMonthPoint): from the order list's footer, the orders created since the 1st that are "Đã nhận" (3) and "Đã hoàn" (5).
 */
async function receivedMonthSeries(session: PancakeSession, shop: PancakeShop, month: CumulativePoint[], to: string) {
  const first = monthStart(to);
  const dates = [to, addDays(to, -1)].filter((date) => date >= first);
  const series: CumulativePoint[] = [];
  for (const date of dates) {
    const point = month.find((item) => item.date === date);
    if (!point) continue;
    const totals = await fetchPosStatusTotals(session, shop, { from: first, to: date }, ["3", "5"]);
    const none = { orders: 0, cod: 0, prepaid: 0 };
    series.push(receivedMonthPoint(point, totals.get("3") ?? none, totals.get("5") ?? none));
  }
  if (!series.some((item) => item.date === to)) throw new Error("month point missing");
  return series;
}

/**
 * First day the cumulative refund figures are added up from: PANCAKE_REFUND_SINCE (the day the shop started selling) when set, else a
 * year back (the statistics are read 31 days at a time, so a longer default would mean many more requests on every sync).
 */
function refundHistoryStart(today: string, override = process.env.PANCAKE_REFUND_SINCE) {
  const wanted = override?.trim();
  return wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : addDays(today, -REFUND_HISTORY_DAYS);
}
const REFUND_HISTORY_DAYS = 365;

/** Orders created in the range that are being returned (4, 18) or partly returned (15): the statuses the statistics leave out of "returned". */
async function fetchReturningOrders(session: PancakeSession, shop: PancakeShop, range: { from: string; to: string }) {
  const offset = bucketUtcOffset();
  const orders: ReturningOrder[] = [];
  for (let page = 1; page <= MAX_ORDER_PAGES; page += 1) {
    const response = await session.callTool<{ data?: ReturningOrder[]; total_entries?: number }>("pos_order", {
      action: "list",
      shop_id: shop.id,
      start_date_time: Date.parse(dayBoundsUtc(range.from, offset, "start")) / 1000,
      end_date_time: Date.parse(dayBoundsUtc(range.to, offset, "end")) / 1000,
      page_size: ORDER_PAGE_SIZE,
      page_number: page,
      filter_status: RETURNING_STATUSES,
      fields: ["id", "inserted_at", "status", "total_price", "total_quantity", "items"],
    });
    orders.push(...(response.data ?? []));
    if (page * ORDER_PAGE_SIZE >= (response.total_entries ?? 0)) break;
  }
  return orders;
}

/**
 * The refund rate of every report day for the return provision (return-provision.ts): the orders created 30-90 days before the
 * day, refunds = returned (status 5, from the statistics) + being returned / partly returned (read from the order list).
 */
async function loadProvisionRates(session: PancakeSession, shop: PancakeShop, dataset: PosDataset) {
  const range = provisionRange(dataset.range.from, dataset.range.to);
  if (range.to < range.from) return new Map<string, ProvisionRate>();
  const figures = new Map<string, RefundDay>();
  for (const row of (await fetchQuery(session, shop, ["Time.day"], range)).rows) {
    const date = row.keys["Time.day"];
    if (date) figures.set(date, { confirmed: row.facts.confirmed.revenue, returned: Math.abs(row.facts.returned.revenue), orders: row.facts.confirmed.orderCount, refunded: row.facts.returned.orderCount });
  }
  for (const { date, amount } of returningAmounts(await fetchReturningOrders(session, shop, range), bucketUtcOffset())) {
    const before = figures.get(date) ?? { confirmed: 0, returned: 0, orders: 0, refunded: 0 };
    figures.set(date, { ...before, returned: before.returned + amount, refunded: before.refunded + 1 });
  }
  return provisionRates(
    dataset.days.map((day) => day.date),
    (date) => figures.get(date),
  );
}

/** What the report says about the automatic return provision. */
function describeProvision(provision: Map<string, ProvisionRate> | null, costs: ManualCostRow[], dates: string[]) {
  if (!provision) return [];
  const rated = dates.filter((date) => provision.has(date));
  if (!rated.length) return ["⚠ Chưa có đủ lịch sử đơn (30–90 ngày trước) để tính dự phòng hoàn tự động: dự phòng hoàn chỉ lấy số nhập tay."];
  const typed = rated.filter((date) => costsForAnyScope(costs, date).returnProvision > 0).length;
  const first = provision.get(rated[0]) as ProvisionRate;
  const last = provision.get(rated[rated.length - 1]) as ProvisionRate;
  const percent = (rate: number) => `${(rate * 100).toFixed(1).replace(".", ",")}%`;
  const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
  return [
    `Dự phòng hoàn (tự tính): hoàn dự kiến của ngày = doanh số trước hoàn × tỷ lệ hoàn của các đơn tạo cách đó 30–90 ngày (hoàn = đã hoàn + đang hoàn + hoàn một phần); dự phòng = hoàn dự kiến trừ phần đã hoàn thật đã trừ khỏi doanh thu (không âm), nên ngày cũ gần như không còn dự phòng. Ví dụ ngày ${toDmy(rated[rated.length - 1])}: ${percent(last.rate)} (${money.format(last.returned)} ₫ hoàn / ${money.format(last.confirmed)} ₫ doanh số, đơn tạo ${toDmy(last.from)}–${toDmy(last.to)})${rated.length > 1 ? `; ngày ${toDmy(rated[0])}: ${percent(first.rate)}` : ""}. Giá vốn giảm cùng tỷ lệ vì hàng hoàn về kho.${typed ? ` ${typed} ngày đã nhập dự phòng riêng nên dùng số đó.` : " Ngày nào nhập dự phòng riêng thì dùng số đó."}`,
  ];
}

/** What the report says about the costs read from MySQL. */
function describeStoredCosts(stored: CostEntry[] | null, expanded: ManualCostRow[], hasFileCosts: boolean, inDong = false) {
  if (stored === null) return ["Chưa cấu hình MySQL: chi phí chỉ lấy từ file chi phí (nếu có)."];
  if (!stored.length) return ["MySQL chưa có khoản chi phí nào cho shop này trong khoảng ngày đã chọn."];

  const warnings = [`Đã áp dụng ${stored.length} khoản chi phí từ MySQL (phân bổ thành ${expanded.length} dòng theo ngày).`];
  if (hasFileCosts) warnings.push("Đang dùng cả file chi phí và MySQL: hai nguồn được cộng dồn, hãy chắc không nhập trùng một khoản.");

  // The Philippines shop shares monthly staff pay out by revenue instead (ph-payroll.ts), so "công chuẩn" does not apply there.
  const perWorkDay = stored.filter((entry) => entry.scope === "staff" && entry.workDays && entry.staffName && !(inDong && isRevenueSharedPay(entry)));
  if (perWorkDay.length) {
    const names = new Map(perWorkDay.map((entry) => [normalizeText(entry.staffName as string), entry.staffName as string]));
    const charged = new Set(expanded.filter((row) => row.staff).map((row) => normalizeText(row.staff as string)));
    const idle = Array.from(names).filter(([key]) => !charged.has(key)).map(([, name]) => name);
    warnings.push(`Lương/thưởng của ${names.size} nhân sự tính theo ngày có đơn hoặc doanh thu trong POS (lương tháng ÷ số công chuẩn); ngày nghỉ không tính.`);
    if (idle.length) {
      warnings.push(`Không tính lương/thưởng của ${idle.join(", ")}: không có đơn hoặc doanh thu trong kỳ (hoặc tên khác với tên trong POS).`);
    }
  }
  if (inDong && stored.some((entry) => entry.scope === "staff")) {
    warnings.push("Chi phí theo nhân sự của shop Philippines nhập bằng đồng (₫) và được quy đổi sang peso theo tỷ giá của từng ngày.");
  }
  return warnings;
}

/** What the report says about the accountant's daily cost sheet. */
function describeSheet(cells: SheetCell[], precedence: SheetPrecedence, dates: string[], rows: ManualCostRow[]) {
  if (!cells.length) return [];
  const filledDays = new Set(cells.filter((cell) => cell.amount > 0).map((cell) => cell.date));
  const warnings = [`Đã áp dụng bảng chi phí kế toán theo ngày: ${filledDays.size}/${dates.length} ngày trong kỳ có số.`];
  const missing = daysWithoutSheet(rows, dates);
  if (missing.length) {
    warnings.push(
      `Chưa có chi phí kế toán cho ${missing.length} ngày (${missing.slice(0, 4).map(toDmy).join(", ")}${missing.length > 4 ? "…" : ""}): các ngày này dùng chi phí ước tính từ MySQL/file.`,
    );
  }
  if (precedence.replaced.length) {
    warnings.push(
      `Số kế toán thay cho số ước tính: ${precedence.replaced.map((item) => `${item.label} (${item.days} ngày)`).join(", ")}.`,
    );
  }
  return warnings;
}

/** Pulls everything the report pages need for the requested days in one MCP session. */
export async function syncFromPancake(request: PancakeSyncRequest, deps: SyncDeps = {}): Promise<PancakeSyncResult> {
  const allShops = await listAllShops();
  const { shop, apiKey } = resolveShop(allShops, request.shopId);
  const currency = shop.currency.toUpperCase();
  if (currency !== "PHP" && currency !== "VND") {
    throw new PancakeError(`Shop dùng tiền tệ ${shop.currency || "không rõ"}; chỉ hỗ trợ shop VND và PHP.`, 400);
  }
  // With several Philippines shops, only one of them takes the Meta ad spend (see phAdsShopId).
  const phShops = allShops.entries.filter((entry) => entry.shop.currency.toUpperCase() === "PHP");
  const adsShopId = currency === "PHP" && phShops.length > 1 ? phAdsShopId(phShops.map((entry) => entry.shop)) : undefined;
  const adsOnOtherShop = adsShopId !== undefined && adsShopId !== shop.id;

  // The Philippines shops keep one set of hand-entered costs (ph-shops.ts). The amounts are booked on the main shop only, so a report
  // that adds the shops together counts them once; the rates (cost of goods, per-order costs) apply to every shop's own orders.
  const costsOnOtherShop = currency === "PHP" && !carriesSharedCosts(shop.id);
  // A configured database that cannot be read must fail the sync: reports silently missing costs would be wrong.
  const storedEntries = costsOnOtherShop ? [] : await (deps.loadCostEntries ?? defaultLoadCostEntries)(shop.id, request.from, request.to);
  const sheetCells = costsOnOtherShop ? [] : await (deps.loadDailyCosts ?? defaultLoadDailyCosts)(shop.id, request.from, request.to);

  const session = await PancakeSession.open(apiKey);
  const now = (deps.now ?? Date.now)();
  const { dataset, warnings: loadWarnings } = await loadDataset(session, shop, request.from, request.to, now);
  const previousDay = currency === "PHP" ? await loadPreviousDay(session, shop, dataset) : undefined;
  // The old shop's totals are the business's own, so only the main Philippines shop adds them (a report adding the shops counts them once).
  const legacyTotals = currency === "PHP" && !costsOnOtherShop ? await (deps.loadLegacyTotals ?? defaultLoadLegacyTotals)(shop.id) : null;
  const refundTrend = currency === "PHP" ? await loadRefundTrend(session, shop, dataset, todayAt(bucketUtcOffset(), now), legacyTotals) : undefined;
  let openOrders: OpenOrders | undefined;
  const openWarnings: string[] = [];
  if (currency === "PHP") {
    try {
      openOrders = await loadOpenOrders(session, shop, now);
    } catch (error) {
      openWarnings.push(`⚠ Không đọc được các đơn đang mở từ POS nên mục “Hiện trạng dòng tiền” dùng số liệu của ngày: ${error instanceof Error ? error.message : "lỗi không xác định"}.`);
    }
  }

  // Pay charged per working day (monthly pay over the standard working days) needs to know who worked each day, which
  // only the POS data says, so the stored costs are spread out after it was read.
  const fileCosts = request.costs ?? [];
  const sheetRows = sheetCellsToCostRows(sheetCells);
  // Like costs, a configured database that cannot be read fails the sync instead of silently using a wrong rate.
  const rates = currency === "PHP" ? await (deps.loadExchangeRates ?? defaultLoadExchangeRates)() : null;
  const today = todayAt(bucketUtcOffset(), now);
  // The Philippines staff are paid in dong: their stored costs are turned into pesos with the rate the report uses for the day.
  const latestStored = rates ? latestRate(rates, today) : null;
  const dongPerPeso = (date: string) => exchangeRateFor([...fileCosts, ...sheetRows], date) ?? latestStored?.rate ?? PH_DEFAULT_EXCHANGE_RATE;
  // Their monthly pay and bonus are not spread per working day but shared out by revenue (lib/pancake/ph-payroll.ts).
  // The Vietnam shop's two monthly salary totals (Sale/CSKH, other departments) are shared out by revenue the same way (dong, rate 1).
  const isSharedPay = currency === "PHP" ? isRevenueSharedPay : isRevenueSharedTotal;
  const sharedEntries = storedEntries ? storedEntries.filter(isSharedPay) : [];
  const spreadEntries = storedEntries && sharedEntries.length ? storedEntries.filter((entry) => !isSharedPay(entry)) : storedEntries;
  const expandedCosts = spreadEntries ? expandCostEntries(spreadEntries, request.from, request.to, { worked: staffWorkedOn(dataset) }) : [];
  const shared = sharedEntries.length ? await sharedPayCosts(session, shop, dataset, sharedEntries, currency === "PHP" ? dongPerPeso : () => 1, today, (facts) => facts.net.revenue) : null;
  const databaseCosts = currency === "PHP" ? [...staffCostsToPesos(expandedCosts, dongPerPeso), ...(shared?.rows ?? [])] : [...expandedCosts, ...(shared?.rows ?? [])];
  const costs = [...fileCosts, ...databaseCosts, ...sheetRows];
  // A day that has the shop's salary totals shared out already carries all the salary: the per-staff pay of that day then only
  // belongs in the staff performance report, not in the whole-shop costs (it would be counted twice).
  const totalPayDays = new Set(currency === "VND" ? (shared?.rows ?? []).map((row) => row.date) : []);
  // The same for the fixed cost and the other fixed cost totals (divided evenly over the days of the month).
  const shopTotalDays = (costType: "fixed_cost" | "other_cost") =>
    new Set(
      currency === "VND" && storedEntries
        ? listDays(request.from, request.to).filter((date) =>
            storedEntries.some((entry) => entry.scope === "shop" && entry.period === "monthly" && entry.costType === costType && entry.validFrom <= date && (entry.validTo === null || date <= entry.validTo)),
          )
        : [],
    );
  const totalFixedDays = shopTotalDays("fixed_cost");
  const totalOtherDays = shopTotalDays("other_cost");
  const shopBase =
    totalPayDays.size || totalFixedDays.size || totalOtherDays.size
      ? costs.map((row) => {
          if (!row.staff || !row.date) return row;
          return {
            ...row,
            ...(totalPayDays.has(row.date) ? { salarySaleCskh: 0, salaryOther: 0 } : {}),
            ...(totalFixedDays.has(row.date) ? { fixedCost: 0 } : {}),
            ...(totalOtherDays.has(row.date) ? { otherCost: 0 } : {}),
          };
        })
      : costs;
  // The whole-shop reports take the accountant's figures over the estimates of the same day and kind; the staff
  // performance report keeps the per-staff pay it is made of.
  const precedence = applySheetPrecedence(shopBase);
  const costWarnings = [
    ...(costsOnOtherShop
      ? [
          `Chi phí nhập tay và bảng chi phí kế toán dùng chung cho các shop Phil nên được tính vào shop “${phShops.find((entry) => entry.shop.id === mainPhShopId())?.shop.name ?? mainPhShopId()}”, không tính ở shop này để báo cáo gộp không bị đếm đôi. Tỷ lệ giá vốn và chi phí theo đơn vẫn áp dụng cho đơn của shop này.`,
        ]
      : describeStoredCosts(storedEntries, databaseCosts, fileCosts.length > 0, currency === "PHP")),
    ...(shared ? (currency === "PHP" ? describeSharedPay(shared.months) : describeSharedTotals(shared.months)) : []),
    ...(totalPayDays.size ? ["Lương theo nhân sự chỉ dùng cho Báo cáo hiệu suất; chi phí lương của báo cáo quản trị lấy từ lương tổng (Sale/CSKH + bộ phận khác) nên các ngày đó không cộng thêm lương theo nhân sự."] : []),
    ...(totalFixedDays.size || totalOtherDays.size ? ["Định phí và định phí khác của báo cáo quản trị lấy từ tổng theo tháng (chia đều cho số ngày của tháng); định phí theo nhân sự chỉ dùng cho Báo cáo hiệu suất."] : []),
    ...describeSheet(sheetCells, precedence, listDays(request.from, request.to), sheetRows),
  ];
  // Ad spend of the Meta accounts labelled for this shop. A failure never fails the sync: the report is built from the
  // POS and the cost lines, and says so loudly.
  const market: AdsMarket = currency === "PHP" ? "PH" : "VN";
  let metaSpend: MetaSpend | null = null;
  const metaWarnings: string[] = [];
  if (request.useMetaAds !== false && adsOnOtherShop) {
    const carrier = phShops.find((entry) => entry.shop.id === adsShopId)?.shop.name ?? adsShopId;
    metaWarnings.push(`Chi phí Ads Meta (nhãn PH) dùng chung cho các shop Phil nên được tính vào shop “${carrier}”, không tính ở shop này để báo cáo gộp không bị đếm đôi.`);
  } else if (request.useMetaAds !== false) {
    try {
      metaSpend = await (deps.loadMetaSpend ?? defaultLoadMetaSpend)(market, request.from, request.to);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "lỗi không xác định";
      metaWarnings.push(`⚠ Không lấy được chi phí Ads Meta: ${reason} Báo cáo đang dùng chi phí ads từ POS/file.`);
    }
  }
  const meta = metaSpend ? applyMetaAds({ market, spend: metaSpend, costs: precedence.rows, rates, today }) : null;
  if (meta) metaWarnings.push(...meta.warnings);
  const shopCosts = meta ? [...precedence.rows, ...meta.lines] : precedence.rows;

  // A shop whose products carry their own cost in the POS uses it for the cost of goods instead of the average cost per kind of goods.
  const posCost = currency === "PHP" && usesPosCost(shop.id);
  const cogsHistory = currency === "PHP" && !posCost ? await (deps.loadCogsRates ?? defaultLoadCogsRates)(shop.id) : [];
  // Philippines: the products sold per day and kind (the base of the per-product costs and of the cost of goods by kind).
  let sold: SoldItems | null = null;
  if (currency === "PHP") {
    try {
      sold = await loadSoldItems(session, shop, dataset);
    } catch {
      sold = null;
    }
  }
  // Vietnam: the return provision of the estimated figures, from the refund rate of the orders created 30-90 days before each day.
  let provision: Map<string, ProvisionRate> | null = null;
  const provisionWarnings: string[] = [];
  if (currency === "VND") {
    try {
      provision = await loadProvisionRates(session, shop, dataset);
      provisionWarnings.push(...describeProvision(provision, shopCosts, dataset.days.map((day) => day.date)));
    } catch (error) {
      provisionWarnings.push(`⚠ Không tính được dự phòng hoàn tự động từ lịch sử POS (${error instanceof Error ? error.message : "lỗi không xác định"}): dự phòng hoàn chỉ lấy số nhập tay.`);
    }
  }
  const reports =
    currency === "PHP"
      ? philippinesReports(
          dataset,
          shopCosts,
          rates,
          today,
          await (deps.loadOrderRates ?? defaultLoadOrderRates)(shop.id),
          cogsHistory.length && sold ? categoryCogs(sold, dataset, cogsHistory, (date) => costsForAnyScope(shopCosts, date).cogs > 0) : null,
          sold,
          adsOnOtherShop,
          refundTrend,
          posCost,
        )
      : vietnamReports(dataset, { staff: meta ? [...costs, ...meta.lines] : costs, shop: shopCosts }, provision);

  return {
    shop,
    range: { from: request.from, to: request.to, dayCount: dataset.range.dayCount },
    reportDate: rangeLabel(request.from, request.to),
    fetchedAt: dataset.fetchedAt,
    dataset,
    ...reports,
    ...(meta ? { metaAds: meta.summary } : {}),
    ...(previousDay ? { previousDay } : {}),
    ...(refundTrend ? { refundTrend } : {}),
    ...(openOrders ? { openOrders } : {}),
    warnings: [...checkWarnings(dataset), ...loadWarnings, ...describeReturns(dataset, currency), ...costWarnings, ...provisionWarnings, ...reports.warnings, ...metaWarnings, ...openWarnings],
  };
}

type CategoryCogs = { onDay: (date: string) => { estimated: number; actual: number } | undefined; notes: string[] };

/** The fields of an order that tell what was sold (the order list is large, so only these are asked for). */
const COGS_ORDER_FIELDS = ["id", "inserted_at", "status", "tags", "note", "note_print", "items", "total_quantity"];

/** Every order created in the range, whatever its status (canceled ones are dropped by the classifier). */
async function fetchOrdersForCogs(session: PancakeSession, shop: PancakeShop, range: { from: string; to: string }) {
  const offset = bucketUtcOffset();
  const query = (page: number) =>
    session.callTool<{ data?: CogsOrder[]; total_entries?: number }>("pos_order", {
      action: "list",
      shop_id: shop.id,
      start_date_time: Date.parse(dayBoundsUtc(range.from, offset, "start")) / 1000,
      end_date_time: Date.parse(dayBoundsUtc(range.to, offset, "end")) / 1000,
      page_size: ORDER_PAGE_SIZE,
      page_number: page,
      fields: COGS_ORDER_FIELDS,
    });
  const first = await query(1);
  const total = first.total_entries ?? first.data?.length ?? 0;
  const pages = Math.ceil(total / ORDER_PAGE_SIZE);
  if (pages > MAX_ORDER_PAGES) throw new PancakeError("Quá nhiều đơn để tính giá vốn theo danh mục trong khoảng ngày này. Hãy chọn khoảng ngắn hơn.", 502);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => query(index + 2)));
  return [first, ...rest].flatMap((response) => response.data ?? []);
}

/** The products sold per day and kind in the report's range (every order created in it, canceled ones left out). */
type SoldItems = {
  days: Map<string, DayQuantities>;
  mixed: number;
  unreadable: number;
  /** Products sold in the whole range. */
  total: number;
  /** Products sold on a day (all kinds), the base of the per-product costs. */
  itemsOn: (date: string) => number | undefined;
  warning?: string;
};

/** Reads the orders of the range once and counts the products sold per day and kind (ph-cogs.ts). */
async function loadSoldItems(session: PancakeSession, shop: PancakeShop, dataset: PosDataset): Promise<SoldItems> {
  const orders = await fetchOrdersForCogs(session, shop, dataset.range);
  const { days, mixed, unreadable } = quantitiesByDay(orders, bucketUtcOffset());
  const itemsOn = (date: string) => {
    const day = days.get(date);
    return day ? COGS_CATEGORIES.reduce((sum, { key }) => sum + day.estimated[key], 0) : undefined;
  };
  let total = 0;
  for (const day of days.values()) for (const { key } of COGS_CATEGORIES) total += day.estimated[key];
  const emptyDays = dataset.days.filter((day) => day.facts.confirmed.orderCount > 0 && !(itemsOn(day.date) ?? 0)).map((day) => toDmy(day.date));
  const warning = emptyDays.length
    ? `⚠ ${emptyDays.length} ngày có đơn nhưng không đếm được sản phẩm (${emptyDays.slice(0, 4).join(", ")}${emptyDays.length > 4 ? "…" : ""}): chi phí theo sản phẩm của các ngày này đang = 0.`
    : undefined;
  return { days, mixed, unreadable, total, itemsOn, ...(warning ? { warning } : {}) };
}

/**
 * The Philippines cost of goods from the items sold per kind of goods x the average cost of the kind (ph-cogs.ts). Only worked out
 * when average costs were saved.
 */
function categoryCogs(
  { days, mixed, unreadable }: SoldItems,
  dataset: PosDataset,
  history: CogsRatesEntry[],
  /** A day the accountant typed a cost of goods for: that figure is used, so the day is left out of the summary. */
  isTyped: (date: string) => boolean,
): CategoryCogs {
  const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
  const dates = dataset.days.map((day) => day.date);
  const notes: string[] = [];

  const covered = dates.filter((date) => cogsRatesOn(history, date) && !isTyped(date));
  const typedDays = dates.filter((date) => cogsRatesOn(history, date) && isTyped(date)).length;
  const uncovered = dates.filter((date) => !cogsRatesOn(history, date) && !isTyped(date));
  if (covered.length) {
    const count = { shoes: 0, sets: 0, clothes: 0 };
    let estimated = 0;
    let actual = 0;
    for (const date of covered) {
      const rates = cogsRatesOn(history, date);
      if (!rates) continue;
      const day = days.get(date);
      const cost = cogsOfDay(day, rates);
      estimated += cost.estimated;
      actual += cost.actual;
      for (const { key } of COGS_CATEGORIES) count[key] += day?.estimated[key] ?? 0;
    }
    const last = cogsRatesOn(history, covered[covered.length - 1]);
    const parts = COGS_CATEGORIES.map(({ key, label }) => `${label} ${count[key]} × ${money.format(last?.[key] ?? 0)} ₱`).join(" + ");
    notes.push(
      `Giá vốn tính theo danh mục (số sản phẩm bán ra × giá vốn trung bình): ${parts} = ${money.format(estimated)} ₱ dự tính, ${money.format(actual)} ₱ thực tế sau đơn hoàn. Đơn có thẻ “Quần Áo” là đồ bộ nếu ghi chú có chữ “set”, không thì quần áo lẻ; đơn khác là giày dép. ${typedDays ? `${typedDays} ngày kế toán đã nhập giá vốn riêng nên dùng số đó (không nằm trong số trên).` : "Ngày kế toán nhập giá vốn riêng thì dùng số đó."}`,
    );
  }
  if (uncovered.length) {
    notes.push(
      `⚠ ${uncovered.length} ngày chưa có giá vốn theo danh mục (bộ giá vốn đầu tiên có hiệu lực từ ${toDmy(history.map((entry) => entry.effectiveDate).sort()[0])}): các ngày này dùng giá vốn nhập tay hoặc của POS.`,
    );
  }
  if (mixed) {
    notes.push(
      `⚠ ${mixed} đơn có thể lẫn giày và quần áo (thẻ “Quần Áo” kèm cỡ giày, hoặc có chữ “set” nhưng không có thẻ): chưa tách được, đang tính theo thẻ nên giá vốn các đơn này có thể lệch.`,
    );
  }
  if (unreadable) notes.push(`⚠ ${unreadable} đơn không đọc được ngày tạo nên không vào giá vốn theo danh mục.`);

  return {
    onDay: (date) => {
      const rates = cogsRatesOn(history, date);
      return rates ? cogsOfDay(days.get(date), rates) : undefined;
    },
    notes,
  };
}

/** Tag names the POS puts on a delivered order whose COD the shipping partner has not been reconciled with the shop yet. */
const UNRECONCILED_TAG = /unreconcil|chưa đối soát/i;
const DELIVERED_STATUS = 3;
const ORDER_PAGE_SIZE = 1000;
const MAX_ORDER_PAGES = 6;

/**
 * Delivered orders of the range that still carry the "not reconciled" tag, and their COD. The POS order list cannot filter by
 * tag, so the delivered orders are read (a page of 1000 takes a few seconds) and counted here.
 */
async function fetchUnreconciled(request: { shopId?: number; from: string; to: string }) {
  const { shop, apiKey } = resolveShop(await listAllShops(), request.shopId);
  const session = await PancakeSession.open(apiKey);
  const offset = bucketUtcOffset();
  const start = Date.parse(dayBoundsUtc(request.from, offset, "start")) / 1000;
  const end = Date.parse(dayBoundsUtc(request.to, offset, "end")) / 1000;
  let orders = 0;
  let cod = 0;
  for (let page = 1; page <= MAX_ORDER_PAGES; page += 1) {
    const response = await session.callTool<{ data?: { cod?: number; tags?: ({ name?: string } | string)[] }[]; total_entries?: number }>("pos_order", {
      action: "list",
      shop_id: shop.id,
      start_date_time: start,
      end_date_time: end,
      page_size: ORDER_PAGE_SIZE,
      page_number: page,
      filter_status: [DELIVERED_STATUS],
      fields: ["id", "cod", "tags"],
    });
    const rows = response.data ?? [];
    for (const order of rows) {
      if (!(order.tags ?? []).some((tag) => UNRECONCILED_TAG.test(typeof tag === "string" ? tag : (tag.name ?? "")))) continue;
      orders += 1;
      cod += Number(order.cod ?? 0);
    }
    if (page * ORDER_PAGE_SIZE >= (response.total_entries ?? rows.length) || !rows.length) return { orders, cod: round2(cod) };
  }
  throw new PancakeError("Quá nhiều đơn để đọc thẻ chưa đối soát trong mốc này.", 502);
}

/**
 * The last `windowDays` days ending on `to`: where their orders stand now (by status) and their revenue and profit per day.
 * Short reports hardly have any returns yet, so the cumulative reconciliation looks back over a longer window than the
 * report itself. It is the report of that window, with the costs stored in MySQL and the Meta ads (cost files typed into
 * the page are not sent), so a day shows the profit the report of that day shows.
 */
export async function reconcileFromPancake(
  request: {
    shopId?: number;
    to: string;
    windowDays: ReconcileWindow;
    /** Dong per peso for the days that have no stored rate (Philippines). */
    fallbackRate?: number;
  },
  deps: SyncDeps = {},
): Promise<CumulativeReconciliation> {
  const from = addDays(request.to, -(request.windowDays - 1));
  // The tags are read alongside the report (own session) so the extra POS call adds no waiting time; a failure only hides that row.
  const unreconciledRequest = fetchUnreconciled({ shopId: request.shopId, from, to: request.to }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const result = await syncFromPancake({ from, to: request.to, shopId: request.shopId, costs: [] }, deps);
  const { dataset } = result;
  const unreconciledOutcome = await unreconciledRequest;
  const unreconciled = "value" in unreconciledOutcome ? unreconciledOutcome.value : undefined;

  // What the POS run just read, per day, in dong (pesos converted at each day's rate).
  let daily: CumulativeReconciliation["daily"] = [];
  const dongPerPeso = new Map<string, number>();
  if (result.vn) {
    daily = result.vn.days.map((day) => ({ date: day.date, revenue: day.actual.total.revenue, profit: day.actual.total.profit }));
  } else if (result.phRows?.length) {
    const report = processPhilippinesRows(result.phRows, request.fallbackRate ?? PH_DEFAULT_EXCHANGE_RATE);
    daily = report.days.map((day) => ({ date: day.date, revenue: day.comparison.actual.revenue.vnd, profit: day.pnl.netProfit.vnd }));
    for (const day of report.days) dongPerPeso.set(day.date, day.exchangeRate);
  }

  // The profit sheet's figures win for the days it keeps (with the costs typed on it); the POS figure fills the other days.
  const warnings = result.warnings.filter((warning) => warning.startsWith("⚠"));
  if ("error" in unreconciledOutcome) {
    const reason = unreconciledOutcome.error instanceof Error ? unreconciledOutcome.error.message : "lỗi không xác định";
    warnings.push(`⚠ Không đọc được thẻ đơn chưa đối soát từ POS (${reason}): bỏ qua dòng này.`);
  }
  const market = sheetMarketOf(result.shop.currency);
  let dailySource: CumulativeReconciliation["dailySource"];
  try {
    const dates = listDays(from, request.to);
    const stored = await (deps.loadPnlDays ?? defaultLoadPnlDays)(result.shop.id, from, request.to);
    const cells = stored.length ? await (deps.loadDailyCosts ?? defaultLoadDailyCosts)(result.shop.id, from, request.to) : [];
    const sheet = sheetDailyFigures(market, dates, stored, cells);
    const pos = new Map(daily.map((day) => [day.date, day]));
    const merged: CumulativeReconciliation["daily"] = [];
    let fromSheet = 0;
    let fromPos = 0;
    for (const date of dates) {
      const figures = sheet.get(date);
      const rate = market === "PHP" ? (dongPerPeso.get(date) ?? request.fallbackRate ?? PH_DEFAULT_EXCHANGE_RATE) : 1;
      if (figures && (figures.revenue !== 0 || figures.profit !== 0)) {
        merged.push({ date, revenue: market === "PHP" ? pesoToVnd(figures.revenue, rate) : figures.revenue, profit: market === "PHP" ? pesoToVnd(figures.profit, rate) : figures.profit });
        fromSheet += 1;
      } else if (!figures && pos.has(date)) {
        merged.push(pos.get(date)!);
        fromPos += 1;
      }
    }
    daily = merged;
    dailySource = { sheet: fromSheet, pos: fromPos };
  } catch (error) {
    // The sheet is a preference, not a requirement: without it the POS figures stand, and the report says so.
    warnings.push(`⚠ Không đọc được số của Bảng lợi nhuận (${error instanceof Error ? error.message : "lỗi không xác định"}): lợi nhuận theo ngày lấy từ POS.`);
  }

  return {
    windowDays: request.windowDays,
    from,
    to: request.to,
    fetchedAt: dataset.fetchedAt,
    includesToday: dataset.range.includesToday,
    rows: statusRows(dataset),
    daily,
    dailySource,
    ...(unreconciled ? { unreconciled } : {}),
    // Only what makes the numbers wrong (a failed cross-check, ads that could not be read); the rest are the report's own notes.
    warnings,
  };
}

/**
 * Scans a shop's staff: every POS employee, and what each sold between `from` and `to`. Names are the ones the reports use,
 * so the pay typed for a scanned person is matched to their orders. Staff who only appear on orders (an account no longer in
 * the employee list) are included too.
 */
export async function scanStaffFromPancake(request: { shopId?: number; from: string; to: string }, deps: { now?: () => number } = {}): Promise<StaffScan> {
  const { shop, apiKey } = resolveShop(await listAllShops(), request.shopId);
  const session = await PancakeSession.open(apiKey);
  const range = { from: request.from, to: request.to };

  const [employeeList, byStaff, byStaffDay] = await Promise.all([
    loadEmployees(session, shop),
    fetchQuery(session, shop, ["User.id"], range),
    fetchQuery(session, shop, ["Time.day", "User.id"], range),
  ]);
  const { names, employees } = employeeList;

  const entries = new Map<string, StaffScanEntry>();
  const key = (name: string) => normalizeText(name);
  for (const employee of employees) {
    entries.set(key(employee.name), { name: employee.name, department: employee.department, orders: 0, revenue: 0, days: [], employee: true });
  }
  const entryOf = (name: string) => {
    const existing = entries.get(key(name));
    if (existing) return existing;
    const created: StaffScanEntry = { name, department: null, orders: 0, revenue: 0, days: [], employee: false };
    entries.set(key(name), created);
    return created;
  };
  for (const row of byStaff.rows) {
    const id = row.keys["User.id"];
    if (!id) continue;
    const entry = entryOf(staffNameOf(id, names));
    entry.orders += row.facts.created.totalOrderCount;
    entry.revenue = round2(entry.revenue + row.facts.created.revenue);
  }
  for (const row of byStaffDay.rows) {
    const id = row.keys["User.id"];
    const date = row.keys["Time.day"];
    if (!id || !date) continue;
    const { created } = row.facts;
    if (created.totalOrderCount === 0 && created.revenue === 0) continue;
    const entry = entryOf(staffNameOf(id, names));
    if (!entry.days.includes(date)) entry.days.push(date);
  }

  const staff = Array.from(entries.values())
    .map((entry) => ({ ...entry, days: entry.days.sort() }))
    .sort((a, b) => b.revenue - a.revenue || b.days.length - a.days.length || a.name.localeCompare(b.name));
  return { shop, range, fetchedAt: new Date((deps.now ?? Date.now)()).toISOString(), staff };
}

/** Shops from every configured key, plus the keys that failed (so the UI can say which one is broken). */
export async function fetchShops() {
  const { entries, problems } = await listAllShops();
  return { shops: entries.map((entry) => entry.shop), problems };
}
