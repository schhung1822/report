import { isAdsConfigured } from "@/lib/ads/mcp-client";
import { labelsOf, listLabels, type AdsMarket } from "@/lib/ads/labels";
import { fetchLabeledSpend, type MetaSpend } from "@/lib/ads/report";
import { isMysqlConfigured } from "@/lib/costs/db";
import { listDailyCostsForReport } from "@/lib/costs/daily-repository";
import { sheetCellsToCostRows, type SheetCell } from "@/lib/costs/daily-sheet";
import { expandCostEntries } from "@/lib/costs/expand";
import { listEntriesInRange } from "@/lib/costs/repository";
import type { CostEntry } from "@/lib/costs/types";
import { processNormalizedManagementRows } from "@/lib/financial-management";
import { latestRate, RATE_PAIR, type ExchangeRateEntry } from "@/lib/rates/rates";
import { listRates } from "@/lib/rates/repository";
import { calculateDailyRow } from "@/lib/performance-report";
import { PH_DEFAULT_EXCHANGE_RATE, processPhilippinesRows } from "@/lib/philippines-report";
import { normalizeText } from "../workbook";
import { applySheetPrecedence, costsForAnyScope, daysWithoutSheet, hasAnyCost, staffWorkedOn, type SheetPrecedence } from "./costs";
import {
  addMetrics,
  buildDataset,
  factsFromBuckets,
  metricsFromBucket,
  round2,
  staffNameOf,
  UNASSIGNED_STAFF,
  zeroMetrics,
  type FactRow,
  type PosDataset,
  type PosStatusTotals,
  type QueryResult,
} from "./dataset";
import { addDays, bucketUtcOffset, chunkRange, listDays, dayBoundsUtc, monthStart, rangeLabel, toDmy, todayAt } from "./dates";
import { getPancakeConfig, PancakeError, PancakeSession } from "./mcp-client";
import { applyMetaAds } from "./meta-ads";
import { REMOVED_STATUS, statusRows, type CumulativeReconciliation, type ReconcileWindow } from "./status";
import {
  buildChannelResolver,
  mapDailyReport,
  mapFinanceDays,
  mapManagementRows,
  mapPerformanceCumulative,
  mapPerformanceDaily,
} from "./mappers";
import type { RawDailyFinanceRow } from "@/types/finance";
import { POS_SOURCE_SHEET } from "@/types/financial-management";
import type { Bucket, ManualCostRow, PancakeShop, PancakeSyncRequest, PancakeSyncResult, StaffScan, StaffScanEntry } from "./types";

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
  return (response.shops ?? []).map((shop) => ({ id: shop.id, name: shop.name, currency: shop.currency ?? "" }));
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
        // Bucket "confirmed" orders by the day they were created, like the POS order filter. By default Pancake buckets an
        // order by the day it reached its success status, so a "waitting" order created yesterday lands on today's report
        // (verified on a VND shop: 43.617.000 by default vs 40.797.000 = the POS footer with this option).
        success_record: "inserted_at",
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
    fetchQuery(session, shop, ["Order.status"], { from, to }),
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

function philippinesReports(dataset: PosDataset, costs: ManualCostRow[], rates: ExchangeRateEntry[] | null, today: string) {
  const phRows = mapFinanceDays(dataset, costs);
  const rate = applyHouseRate(phRows, rates, today);
  const dates = dataset.days.map((day) => day.date);
  const warnings: string[] = [];
  if (!phRows.length) warnings.push("Pancake POS chưa có đơn nào trong khoảng ngày này.");
  if (!phRows.some((row) => Number(row.payroll) > 0)) {
    warnings.push("Chưa có chi phí lương trong khoảng ngày này (trang Chi phí cố định hoặc file chi phí): đang tính lương = 0.");
  }
  if (!phRows.some((row) => Number(row.ads) > 0)) {
    warnings.push("Chi phí ads = 0: POS chưa ghi nhận ads. Hãy nhập chi phí marketing hoặc chọn tài khoản Ads Meta ở mục “Chi phí & tuỳ chọn”.");
  }
  warnings.push(...rate.warnings);
  const scopedLines = costs.some((row) => (row.channel || row.staff) && hasAmount(row) && (!row.date || dates.includes(row.date)));
  if (scopedLines) warnings.push("Báo cáo Philippines chỉ có một bộ phận nên chi phí theo Kênh/Nhân sự cũng được cộng vào chi phí chung.");
  return { phRows, exchangeRate: rate.latest, warnings };
}

function vietnamReports(dataset: PosDataset, { staff: staffCosts, shop: costs }: { staff: ManualCostRow[]; shop: ManualCostRow[] }) {
  const dates = dataset.days.map((day) => day.date);
  const warnings: string[] = [];

  const daily = mapDailyReport(dataset);
  if (dataset.totals.created.totalOrderCount === 0) warnings.push(`Pancake POS không có đơn nào trong ${rangeLabel(dataset.range.from, dataset.range.to)}.`);

  const performanceRows = mapPerformanceDaily(dataset, staffCosts).map(calculateDailyRow);
  const performance = {
    dailyRows: performanceRows,
    cumulativeRows: mapPerformanceCumulative(dataset),
    reportDate: daily.reportDate,
  };

  // The report shows the whole shop, so the Zalo/Page split of the costs only exists inside the model and adds up to the same total.
  const scopedLines = costs.some((row) => (row.channel || row.staff) && hasAmount(row) && (!row.date || dates.includes(row.date)));
  if (scopedLines) warnings.push("Báo cáo quản trị Việt Nam tính toàn shop (Zalo và Page gộp một) nên chi phí theo Kênh/Nhân sự cũng được cộng vào chi phí chung.");

  const managementRows = mapManagementRows(dataset, costs);
  let vn: PancakeSyncResult["vn"];
  if (managementRows.length) {
    vn = processNormalizedManagementRows(managementRows, POS_SOURCE_SHEET);
    if (!dates.some((date) => hasAnyCost(costsForAnyScope(costs, date)))) {
      warnings.push("Báo cáo quản trị: chưa có lương/định phí/ads trong file chi phí nên đang bằng 0.");
    }
  } else {
    warnings.push("Pancake POS chưa có đơn nào trong khoảng ngày này nên chưa tạo được báo cáo quản trị.");
  }

  if (!performanceRows.some((row) => row.salary > 0 || row.fixedCost > 0)) {
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
  /** Stored exchange-rate history, or null when no database is configured. */
  loadExchangeRates?: () => Promise<ExchangeRateEntry[] | null>;
  /** Clock in milliseconds; tests inject a fixed one. */
  now?: () => number;
};

const defaultLoadCostEntries: NonNullable<SyncDeps["loadCostEntries"]> = async (shopId, from, to) =>
  isMysqlConfigured() ? listEntriesInRange(shopId, from, to) : null;

const defaultLoadDailyCosts: NonNullable<SyncDeps["loadDailyCosts"]> = async (shopId, from, to) =>
  isMysqlConfigured() ? listDailyCostsForReport(shopId, from, to) : [];

const defaultLoadMetaSpend: NonNullable<SyncDeps["loadMetaSpend"]> = async (market, from, to) => {
  if (!isAdsConfigured() || !isMysqlConfigured()) return null;
  const labels = labelsOf(await listLabels(), market);
  return labels.length ? fetchLabeledSpend(labels, from, to) : null;
};

const defaultLoadExchangeRates: NonNullable<SyncDeps["loadExchangeRates"]> = async () =>
  isMysqlConfigured() ? listRates(RATE_PAIR.from, RATE_PAIR.to) : null;

/** What the report says about the costs read from MySQL. */
function describeStoredCosts(stored: CostEntry[] | null, expanded: ManualCostRow[], hasFileCosts: boolean) {
  if (stored === null) return ["Chưa cấu hình MySQL: chi phí chỉ lấy từ file chi phí (nếu có)."];
  if (!stored.length) return ["MySQL chưa có khoản chi phí nào cho shop này trong khoảng ngày đã chọn."];

  const warnings = [`Đã áp dụng ${stored.length} khoản chi phí từ MySQL (phân bổ thành ${expanded.length} dòng theo ngày).`];
  if (hasFileCosts) warnings.push("Đang dùng cả file chi phí và MySQL: hai nguồn được cộng dồn, hãy chắc không nhập trùng một khoản.");

  const perWorkDay = stored.filter((entry) => entry.scope === "staff" && entry.workDays && entry.staffName);
  if (perWorkDay.length) {
    const names = new Map(perWorkDay.map((entry) => [normalizeText(entry.staffName as string), entry.staffName as string]));
    const charged = new Set(expanded.filter((row) => row.staff).map((row) => normalizeText(row.staff as string)));
    const idle = Array.from(names).filter(([key]) => !charged.has(key)).map(([, name]) => name);
    warnings.push(`Lương/thưởng của ${names.size} nhân sự tính theo ngày có đơn hoặc doanh thu trong POS (lương tháng ÷ số công chuẩn); ngày nghỉ không tính.`);
    if (idle.length) {
      warnings.push(`Không tính lương/thưởng của ${idle.join(", ")}: không có đơn hoặc doanh thu trong kỳ (hoặc tên khác với tên trong POS).`);
    }
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
  const { shop, apiKey } = resolveShop(await listAllShops(), request.shopId);
  const currency = shop.currency.toUpperCase();
  if (currency !== "PHP" && currency !== "VND") {
    throw new PancakeError(`Shop dùng tiền tệ ${shop.currency || "không rõ"}; chỉ hỗ trợ shop VND và PHP.`, 400);
  }

  // A configured database that cannot be read must fail the sync: reports silently missing costs would be wrong.
  const storedEntries = await (deps.loadCostEntries ?? defaultLoadCostEntries)(shop.id, request.from, request.to);
  const sheetCells = await (deps.loadDailyCosts ?? defaultLoadDailyCosts)(shop.id, request.from, request.to);

  const session = await PancakeSession.open(apiKey);
  const now = (deps.now ?? Date.now)();
  const { dataset, warnings: loadWarnings } = await loadDataset(session, shop, request.from, request.to, now);

  // Pay charged per working day (monthly pay over the standard working days) needs to know who worked each day, which
  // only the POS data says, so the stored costs are spread out after it was read.
  const fileCosts = request.costs ?? [];
  const databaseCosts = storedEntries ? expandCostEntries(storedEntries, request.from, request.to, { worked: staffWorkedOn(dataset) }) : [];
  const sheetRows = sheetCellsToCostRows(sheetCells);
  const costs = [...fileCosts, ...databaseCosts, ...sheetRows];
  // The whole-shop reports take the accountant's figures over the estimates of the same day and kind; the staff
  // performance report keeps the per-staff pay it is made of.
  const precedence = applySheetPrecedence(costs);
  const costWarnings = [
    ...describeStoredCosts(storedEntries, databaseCosts, fileCosts.length > 0),
    ...describeSheet(sheetCells, precedence, listDays(request.from, request.to), sheetRows),
  ];
  // Like costs, a configured database that cannot be read fails the sync instead of silently using a wrong rate.
  // Ad spend of the Meta accounts labelled for this shop. A failure never fails the sync: the report is built from the
  // POS and the cost lines, and says so loudly.
  const market: AdsMarket = currency === "PHP" ? "PH" : "VN";
  const rates = currency === "PHP" ? await (deps.loadExchangeRates ?? defaultLoadExchangeRates)() : null;
  const today = todayAt(bucketUtcOffset(), now);
  let metaSpend: MetaSpend | null = null;
  const metaWarnings: string[] = [];
  if (request.useMetaAds !== false) {
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

  const reports =
    currency === "PHP"
      ? philippinesReports(dataset, shopCosts, rates, today)
      : vietnamReports(dataset, { staff: meta ? [...costs, ...meta.lines] : costs, shop: shopCosts });

  return {
    shop,
    range: { from: request.from, to: request.to, dayCount: dataset.range.dayCount },
    reportDate: rangeLabel(request.from, request.to),
    fetchedAt: dataset.fetchedAt,
    dataset,
    ...reports,
    ...(meta ? { metaAds: meta.summary } : {}),
    warnings: [...checkWarnings(dataset), ...loadWarnings, ...costWarnings, ...reports.warnings, ...metaWarnings],
  };
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
  const result = await syncFromPancake({ from, to: request.to, shopId: request.shopId, costs: [] }, deps);
  const { dataset } = result;

  let daily: CumulativeReconciliation["daily"] = [];
  if (result.vn) {
    daily = result.vn.days.map((day) => ({ date: day.date, revenue: day.actual.total.revenue, profit: day.actual.total.profit }));
  } else if (result.phRows?.length) {
    const report = processPhilippinesRows(result.phRows, request.fallbackRate ?? PH_DEFAULT_EXCHANGE_RATE);
    daily = report.days.map((day) => ({ date: day.date, revenue: day.comparison.actual.revenue.vnd, profit: day.pnl.netProfit.vnd }));
  }

  return {
    windowDays: request.windowDays,
    from,
    to: request.to,
    fetchedAt: dataset.fetchedAt,
    includesToday: dataset.range.includesToday,
    rows: statusRows(dataset),
    daily,
    // Only what makes the numbers wrong (a failed cross-check, ads that could not be read); the rest are the report's own notes.
    warnings: result.warnings.filter((warning) => warning.startsWith("⚠")),
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
