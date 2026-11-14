/**
 * Normalized view of Pancake POS data. Everything the reports show is derived from a `PosDataset`, so there is
 * one place that knows Pancake's raw field names and one place that proves the numbers add up.
 *
 * Every row carries four views of the same metrics:
 *  - created   : orders created in the period (Pancake `result` bucket)
 *  - confirmed : orders confirmed in the period (`success` bucket); includes goods that were later returned
 *  - returned  : orders created in the period that were returned later (`returned` bucket, by creation day like the others)
 *  - net       : confirmed - returned (order totals `totalOrderCount` follow `created`)
 */
import { listDays } from "./dates";
import type { Bucket, ManagementChannel, PancakeShop } from "./types";

/** Normalized metric name -> Pancake field name. */
export const METRIC_FIELDS = {
  revenue: "revenue",
  profit: "profit",
  capital: "capital",
  partnerFee: "partner_fee",
  adsAmount: "ads_amount",
  transferMoney: "transfer_money",
  /** COD still to collect. Unlike `money_to_collect` (which equals revenue and so already includes prepaid), this excludes `transferMoney`. */
  cod: "cod",
  moneyToCollect: "money_to_collect",
  orderCount: "order_count",
  totalOrderCount: "total_order_count",
} as const;

export type MetricKey = keyof typeof METRIC_FIELDS;
export type Metrics = Record<MetricKey, number>;
export type Facts = { created: Metrics; confirmed: Metrics; returned: Metrics; net: Metrics };

export const METRIC_KEYS = Object.keys(METRIC_FIELDS) as MetricKey[];
const MONEY_KEYS: MetricKey[] = ["revenue", "profit", "capital", "adsAmount"];
const BUCKETS = ["created", "confirmed", "returned"] as const;

export const UNASSIGNED_STAFF = "Chưa gán nhân sự";

/** Rounds to 2 decimals so repeated additions never accumulate floating-point drift. */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function zeroMetrics(): Metrics {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as Metrics;
}

export function metricsFromBucket(bucket: Bucket | null | undefined): Metrics {
  const metrics = zeroMetrics();
  for (const key of METRIC_KEYS) {
    const value = bucket?.[METRIC_FIELDS[key]];
    if (typeof value === "number" && Number.isFinite(value)) metrics[key] = round2(value);
  }
  return metrics;
}

export function addMetrics(a: Metrics, b: Metrics): Metrics {
  const sum = zeroMetrics();
  for (const key of METRIC_KEYS) sum[key] = round2(a[key] + b[key]);
  return sum;
}

function netMetrics(created: Metrics, confirmed: Metrics, returned: Metrics): Metrics {
  const net = zeroMetrics();
  for (const key of METRIC_KEYS) net[key] = round2(confirmed[key] - returned[key]);
  net.totalOrderCount = created.totalOrderCount;
  return net;
}

export function makeFacts(created: Metrics, confirmed: Metrics, returned: Metrics): Facts {
  return { created, confirmed, returned, net: netMetrics(created, confirmed, returned) };
}

export function zeroFacts(): Facts {
  return makeFacts(zeroMetrics(), zeroMetrics(), zeroMetrics());
}

export function factsFromBuckets(result: Bucket | null, success: Bucket | null, returned: Bucket | null): Facts {
  return makeFacts(metricsFromBucket(result), metricsFromBucket(success), metricsFromBucket(returned));
}

export function addFacts(a: Facts, b: Facts): Facts {
  return makeFacts(addMetrics(a.created, b.created), addMetrics(a.confirmed, b.confirmed), addMetrics(a.returned, b.returned));
}

export function sumFacts(list: Facts[]): Facts {
  return list.reduce(addFacts, zeroFacts());
}

/** One row of a Pancake statistics query after normalization. `keys` holds every grouping dimension's value. */
export type FactRow = { keys: Record<string, string | null>; productName: string | null; facts: Facts };

/** Rows of a query plus the totals the API itself reported (`summary`, summed over chunks). */
export type QueryResult = { rows: FactRow[]; summary: Metrics };

export type CheckMismatch = { scope: string; field: string; expected: number; actual: number; diff: number };
export type Check = { id: string; label: string; ok: boolean; mismatches: CheckMismatch[] };

export type StaffEntry = { id: string | null; name: string; facts: Facts };
/** A staff member's orders created on one day: a day with orders or revenue is a day the person worked. */
export type StaffDay = { date: string; name: string; orders: number; revenue: number };

/** What the POS order list shows for one status of the range: its footer (count, COD, prepaid). */
export type PosStatusTotals = { orders: number; cod: number; prepaid: number };
/**
 * `status` is Pancake's numeric order status ("0" new ... "6" canceled, "7" removed). `facts` come from the statistics API,
 * which values returned orders differently from the POS; `pos` is the POS's own figure (absent for removed orders and when
 * the order list could not be read).
 */
export type StatusEntry = { status: string; facts: Facts; pos?: PosStatusTotals };
export type DayEntry = { date: string; facts: Facts };
export type DetailEntry = {
  date: string;
  sourceId: string | null;
  sourceName: string;
  channel: ManagementChannel;
  productId: string | null;
  productName: string | null;
  facts: Facts;
};

export type PosDataset = {
  schemaVersion: 1;
  source: "pancake-pos";
  shop: PancakeShop;
  range: { from: string; to: string; dayCount: number; utcOffsetHours: number; includesToday: boolean };
  fetchedAt: string;
  definitions: Record<"created" | "confirmed" | "returned" | "net", string>;
  /** Sum of `days`. */
  totals: Facts;
  /** Every calendar day of the range; days without orders are zero. */
  days: DayEntry[];
  /** Per staff member over the range. */
  staff: StaffEntry[];
  /** Per staff member from the first of the month of `range.to` up to `range.to`. */
  staffMonthToDate: StaffEntry[];
  /** One row per day x staff member who had orders (orders not assigned to anyone are left out). Absent in older saved reports. */
  staffDays?: StaffDay[];
  /** One row per day x order source x product. */
  detail: DetailEntry[];
  /**
   * Per order status over the range. Unlike `totals`, it also holds the canceled and removed orders, which is what lets a
   * report explain the gap to the POS order filter. Absent in reports saved before this field existed (and `pos` absent in
   * the ones saved before the POS figures were read).
   */
  statuses?: StatusEntry[];
  checks: Check[];
};

export type DatasetInput = {
  shop: PancakeShop;
  from: string;
  to: string;
  utcOffsetHours: number;
  includesToday: boolean;
  fetchedAt: string;
  byDay: QueryResult;
  byStaff: QueryResult;
  byStaffMonth: QueryResult;
  byStaffDay: QueryResult;
  detail: QueryResult;
  byStatus: QueryResult;
  posByStatus: Map<string, PosStatusTotals>;
  staffNames: Map<string, string>;
  sourceName: (sourceId: string | null) => string;
  channelOf: (sourceId: string | null) => ManagementChannel;
};

function aggregateBy(rows: FactRow[], keyOf: (row: FactRow) => string) {
  const groups = new Map<string, Facts>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, addFacts(groups.get(key) ?? zeroFacts(), row.facts));
  }
  return groups;
}

export const staffNameOf = (id: string, staffNames: Map<string, string>) => staffNames.get(id) ?? `Nhân sự ${id.slice(0, 8)}`;

function staffEntries(rows: FactRow[], staffNames: Map<string, string>): StaffEntry[] {
  const NONE = "\u0000none";
  const groups = aggregateBy(rows, (row) => row.keys["User.id"] ?? NONE);
  return Array.from(groups, ([key, facts]) => {
    const id = key === NONE ? null : key;
    const name = id ? staffNameOf(id, staffNames) : UNASSIGNED_STAFF;
    return { id, name, facts };
  }).sort((a, b) => b.facts.created.revenue - a.facts.created.revenue);
}

function staffDayEntries(rows: FactRow[], staffNames: Map<string, string>): StaffDay[] {
  const days: StaffDay[] = [];
  for (const row of rows) {
    const date = row.keys["Time.day"];
    const id = row.keys["User.id"];
    if (!date || !id) continue;
    const { created } = row.facts;
    if (created.totalOrderCount === 0 && created.revenue === 0) continue;
    days.push({ date, name: staffNameOf(id, staffNames), orders: created.totalOrderCount, revenue: created.revenue });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function statusEntries(rows: FactRow[], posByStatus: Map<string, PosStatusTotals>): StatusEntry[] {
  const groups = aggregateBy(
    rows.filter((row) => row.keys["Order.status"] !== null),
    (row) => row.keys["Order.status"] as string,
  );
  return Array.from(groups, ([status, facts]): StatusEntry => ({ status, facts, pos: posByStatus.get(status) })).sort(
    (a, b) => Number(a.status) - Number(b.status),
  );
}

function compareFacts(scope: string, expected: Facts, actual: Facts, keys: MetricKey[], tolerance: number) {
  const mismatches: CheckMismatch[] = [];
  for (const bucket of BUCKETS) {
    for (const key of keys) {
      const diff = round2(actual[bucket][key] - expected[bucket][key]);
      if (Math.abs(diff) > tolerance) {
        mismatches.push({ scope: `${scope}/${bucket}`, field: key, expected: expected[bucket][key], actual: actual[bucket][key], diff });
      }
    }
  }
  return mismatches;
}

function buildChecks(input: DatasetInput, days: DayEntry[], totals: Facts, staff: StaffEntry[], detail: DetailEntry[]): Check[] {
  const inRange = new Set(days.map((day) => day.date));
  const strayDays = input.byDay.rows
    .map((row) => row.keys["Time.day"])
    .filter((date): date is string => Boolean(date) && !inRange.has(date as string));

  const summaryMismatches: CheckMismatch[] = [];
  for (const key of METRIC_KEYS) {
    const diff = round2(totals.created[key] - input.byDay.summary[key]);
    if (Math.abs(diff) > 0.01) {
      summaryMismatches.push({ scope: "ngày/summary", field: key, expected: input.byDay.summary[key], actual: totals.created[key], diff });
    }
  }

  const staffMismatches = compareFacts("nhân sự", totals, sumFacts(staff.map((entry) => entry.facts)), METRIC_KEYS, 0.01);
  // Pancake rounds each product row on its own, so the sum of thousands of rows drifts from the day total by a few dong
  // (9 dong of 226 million profit on a month of a dong shop): allow one millionth of the revenue, and at least 1.
  const detailTolerance = Math.max(1, Math.abs(totals.created.revenue) * 1e-6);
  const detailMismatches = compareFacts("chi tiết", totals, sumFacts(detail.map((entry) => entry.facts)), MONEY_KEYS, detailTolerance);

  return [
    {
      id: "range",
      label: "Mọi dòng dữ liệu nằm trong khoảng ngày đã chọn",
      ok: strayDays.length === 0,
      mismatches: strayDays.map((date) => ({ scope: "ngày", field: date, expected: 0, actual: 1, diff: 1 })),
    },
    { id: "api-summary", label: "Tổng các ngày khớp tổng do Pancake báo (summary)", ok: !summaryMismatches.length, mismatches: summaryMismatches },
    { id: "staff", label: "Tổng theo nhân sự khớp tổng theo ngày", ok: !staffMismatches.length, mismatches: staffMismatches },
    { id: "detail", label: "Tổng theo nguồn × sản phẩm khớp tổng theo ngày", ok: !detailMismatches.length, mismatches: detailMismatches },
  ];
}

export function buildDataset(input: DatasetInput): PosDataset {
  const dayFacts = aggregateBy(input.byDay.rows, (row) => row.keys["Time.day"] ?? "");
  const days: DayEntry[] = listDays(input.from, input.to).map((date) => ({ date, facts: dayFacts.get(date) ?? zeroFacts() }));
  const totals = sumFacts(days.map((day) => day.facts));

  const staff = staffEntries(input.byStaff.rows, input.staffNames);
  const detail: DetailEntry[] = input.detail.rows
    .filter((row) => row.keys["Time.day"])
    .map((row) => {
      const sourceId = row.keys["Order.order_sources"] ?? null;
      return {
        date: row.keys["Time.day"] as string,
        sourceId,
        sourceName: input.sourceName(sourceId),
        channel: input.channelOf(sourceId),
        productId: row.keys["Variation.product_id"] ?? null,
        productName: row.productName,
        facts: row.facts,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    schemaVersion: 1,
    source: "pancake-pos",
    shop: input.shop,
    range: {
      from: input.from,
      to: input.to,
      dayCount: days.length,
      utcOffsetHours: input.utcOffsetHours,
      includesToday: input.includesToday,
    },
    fetchedAt: input.fetchedAt,
    definitions: {
      created: "Đơn tạo trong kỳ, không gồm đơn mới và đơn huỷ (Pancake bucket result)",
      confirmed: "Đơn chốt trong kỳ (bucket success), đã gồm hàng sau đó bị hoàn",
      returned: "Đơn tạo trong kỳ đã bị hoàn (bucket returned, tính vào ngày tạo đơn)",
      net: "Chốt − hoàn; totalOrderCount lấy theo đơn tạo",
    },
    totals,
    days,
    staff,
    staffMonthToDate: staffEntries(input.byStaffMonth.rows, input.staffNames),
    staffDays: staffDayEntries(input.byStaffDay.rows, input.staffNames),
    detail,
    statuses: statusEntries(input.byStatus.rows, input.posByStatus),
    checks: buildChecks(input, days, totals, staff, detail),
  };
}
