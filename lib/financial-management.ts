import type {
  CalculatedChannelMetrics,
  ChannelMetricsSet,
  DailyManagementSnapshot,
  HiddenStatus,
  ManagementChannel,
  ManagementTrack,
  NormalizedManagementRow,
  ProcessedManagementReport,
  ProductMetric,
  RawChannelMetrics,
} from "@/types/financial-management";
import { parseFinanceDate, parseFinanceNumber } from "@/utils/finance";
import { readWorkbookSheets, type SheetData } from "@/lib/workbook";

const BASE_COLUMNS = {
  date: ["date", "ngay", "ngay bao cao"],
  type: ["type", "loai", "du tinh thuc te", "track"],
  channel: ["channel", "kenh", "nguon"],
  revenue: ["revenue", "doanh thu"],
  cogs: ["cogs", "gia von gtc", "gia von"],
  returnProvision: ["return provision", "du phong hoan", "du phong hang hoan"],
  salarySaleCskh: ["salary sale cskh", "luong cskh sale", "luong sale cskh"],
  salaryOther: ["salary other", "luong cac bp khac", "luong bo phan khac"],
  fixedCost: ["fixed cost", "dinh phi", "chi phi co dinh"],
  otherCost: ["other cost", "chi phi khac"],
  adsCost: ["ads cost", "chi phi marketing", "chi phi ads", "marketing cost"],
  topRevenueProducts: ["top revenue products", "top san pham doanh thu", "top doanh thu san pham"],
  topProfitProducts: ["top profit products", "top san pham loi nhuan", "top loi nhuan san pham"],
} as const;

const METRIC_KEYS = [
  "revenue",
  "cogs",
  "returnProvision",
  "salarySaleCskh",
  "salaryOther",
  "fixedCost",
  "otherCost",
  "adsCost",
] as const;

const PRODUCT_KEYS = ["topRevenueProducts", "topProfitProducts"] as const;

const COLUMN_LABELS: Record<string, string> = {
  date: "Date / Ngày",
  type: "Type / Dự tính - Thực tế",
  channel: "Channel / Kênh",
  revenue: "Revenue / Doanh thu",
  cogs: "COGS / Giá vốn GTC",
  returnProvision: "Return_Provision / Dự phòng hoàn",
  salarySaleCskh: "Salary_Sale_CSKH / Lương CSKH-Sale",
  salaryOther: "Salary_Other / Lương bộ phận khác",
  fixedCost: "Fixed_Cost / Định phí",
  otherCost: "Other_Cost / Chi phí khác",
  adsCost: "Ads_Cost / Chi phí Marketing",
};

type ColumnMap = Record<string, string | undefined>;

export function normalizeManagementHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumn(headers: string[], aliases: readonly string[]) {
  const normalized = headers.map((original) => ({
    original,
    value: normalizeManagementHeader(original),
  }));

  for (const alias of aliases) {
    const exact = normalized.find((header) => header.value === alias);
    if (exact) return exact.original;
  }

  for (const alias of aliases) {
    const partial = normalized.find(
      (header) =>
        header.value.length > 2 &&
        (header.value.includes(alias) || alias.includes(header.value)),
    );
    if (partial) return partial.original;
  }

  return undefined;
}

function findChannelColumn(
  headers: string[],
  channel: ManagementChannel,
  aliases: readonly string[],
) {
  const normalized = headers.map((original) => ({
    original,
    value: normalizeManagementHeader(original),
    withoutChannel: normalizeManagementHeader(original)
      .replace(new RegExp(`\\b${channel}\\b`, "g"), "")
      .replace(/\s+/g, " ")
      .trim(),
  }));

  for (const alias of aliases) {
    const match = normalized.find(
      (header) => header.value.includes(channel) && header.withoutChannel === alias,
    );
    if (match) return match.original;
  }

  for (const alias of aliases) {
    const match = normalized.find(
      (header) =>
        header.value.includes(channel) &&
        (header.withoutChannel.includes(alias) || alias.includes(header.withoutChannel)),
    );
    if (match) return match.original;
  }

  return undefined;
}

function mapLongColumns(headers: string[]): ColumnMap {
  const nonProductHeaders = headers.filter((header) => {
    const normalized = normalizeManagementHeader(header);
    return !normalized.includes("top") && !normalized.includes("product");
  });
  return Object.fromEntries(
    Object.entries(BASE_COLUMNS).map(([key, aliases]) => [
      key,
      findColumn(PRODUCT_KEYS.includes(key as (typeof PRODUCT_KEYS)[number]) ? headers : nonProductHeaders, aliases),
    ]),
  );
}

function mapWideColumns(headers: string[]): ColumnMap {
  const mapped: ColumnMap = {
    date: findColumn(headers, BASE_COLUMNS.date),
    type: findColumn(headers, BASE_COLUMNS.type),
  };

  for (const channel of ["zalo", "page"] as const) {
    for (const key of [...METRIC_KEYS, ...PRODUCT_KEYS]) {
      mapped[`${channel}.${key}`] = findChannelColumn(headers, channel, BASE_COLUMNS[key]);
    }
  }

  return mapped;
}

function requiredLongKeys() {
  return ["date", "type", "channel", ...METRIC_KEYS];
}

function requiredWideKeys() {
  return [
    "date",
    "type",
    ...(["zalo", "page"] as const).flatMap((channel) =>
      METRIC_KEYS.map((key) => `${channel}.${key}`),
    ),
  ];
}

function parseTrack(value: unknown): ManagementTrack | null {
  const normalized = normalizeManagementHeader(value);
  if (["du tinh", "estimated", "estimate", "forecast", "plan"].includes(normalized)) {
    return "estimated";
  }
  if (["thuc te", "actual", "real", "realized"].includes(normalized)) {
    return "actual";
  }
  return null;
}

function parseChannel(value: unknown): ManagementChannel | null {
  const normalized = normalizeManagementHeader(value);
  if (normalized.includes("zalo")) return "zalo";
  if (normalized.includes("page")) return "page";
  return null;
}

function parseProductObject(value: unknown): ProductMetric[] {
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (Array.isArray(item) && item.length >= 2) {
          return { name: String(item[0]).trim(), value: parseFinanceNumber(item[1]) };
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return {
            name: String(record.name ?? record.product ?? record.ten ?? "").trim(),
            value: parseFinanceNumber(record.value ?? record.amount ?? record.giaTri),
          };
        }
        return { name: "", value: 0 };
      })
      .filter((item) => item.name);
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([name, amount]) => ({ name: name.trim(), value: parseFinanceNumber(amount) }))
    .filter((item) => item.name);
}

export function parseProductMetrics(value: unknown): ProductMetric[] {
  if (value && typeof value === "object") return parseProductObject(value);

  const text = String(value ?? "").trim();
  if (!text) return [];

  try {
    return parseProductObject(JSON.parse(text));
  } catch {
    return text
      .split(/[;\n]+|,(?=\s*[^,:;]+[:=])/)
      .map((entry) => {
        const separatorIndex = Math.max(entry.lastIndexOf(":"), entry.lastIndexOf("="));
        if (separatorIndex < 1) return { name: "", value: 0 };
        return {
          name: entry.slice(0, separatorIndex).trim(),
          value: parseFinanceNumber(entry.slice(separatorIndex + 1)),
        };
      })
      .filter((item) => item.name);
  }
}

function emptyRawMetrics(): RawChannelMetrics {
  return {
    revenue: 0,
    cogs: 0,
    returnProvision: 0,
    salarySaleCskh: 0,
    salaryOther: 0,
    fixedCost: 0,
    otherCost: 0,
    adsCost: 0,
    topRevenueProducts: [],
    topProfitProducts: [],
  };
}

export function calculateChannelMetrics(
  metrics: RawChannelMetrics,
): CalculatedChannelMetrics {
  const totalCogs = metrics.cogs + metrics.returnProvision;
  const totalSalary = metrics.salarySaleCskh + metrics.salaryOther;
  const totalFixedCosts = metrics.fixedCost + metrics.otherCost;

  return {
    ...metrics,
    totalCogs,
    totalSalary,
    totalFixedCosts,
    profit: metrics.revenue - (totalCogs + totalSalary + metrics.adsCost + totalFixedCosts),
  };
}

function mergeProducts(...groups: ProductMetric[][]): ProductMetric[] {
  const totals = new Map<string, ProductMetric>();
  groups.flat().forEach((item) => {
    const key = normalizeManagementHeader(item.name);
    const current = totals.get(key);
    if (current) current.value += item.value;
    else totals.set(key, { ...item });
  });
  return Array.from(totals.values()).sort((a, b) => b.value - a.value);
}

function addMetrics(
  ...metrics: CalculatedChannelMetrics[]
): CalculatedChannelMetrics {
  const raw = metrics.reduce<RawChannelMetrics>(
    (total, current) => ({
      revenue: total.revenue + current.revenue,
      cogs: total.cogs + current.cogs,
      returnProvision: total.returnProvision + current.returnProvision,
      salarySaleCskh: total.salarySaleCskh + current.salarySaleCskh,
      salaryOther: total.salaryOther + current.salaryOther,
      fixedCost: total.fixedCost + current.fixedCost,
      otherCost: total.otherCost + current.otherCost,
      adsCost: total.adsCost + current.adsCost,
      topRevenueProducts: mergeProducts(
        total.topRevenueProducts,
        current.topRevenueProducts,
      ),
      topProfitProducts: mergeProducts(total.topProfitProducts, current.topProfitProducts),
    }),
    emptyRawMetrics(),
  );
  return calculateChannelMetrics(raw);
}

function emptyCalculatedMetrics() {
  return calculateChannelMetrics(emptyRawMetrics());
}

function createChannelSet(
  zalo: CalculatedChannelMetrics,
  page: CalculatedChannelMetrics,
): ChannelMetricsSet {
  return { zalo, page, total: addMetrics(zalo, page) };
}

function emptyChannelSet() {
  return createChannelSet(emptyCalculatedMetrics(), emptyCalculatedMetrics());
}

function addChannelSets(a: ChannelMetricsSet, b: ChannelMetricsSet): ChannelMetricsSet {
  return createChannelSet(addMetrics(a.zalo, b.zalo), addMetrics(a.page, b.page));
}

function hiddenStatus(value: number): HiddenStatus {
  return value > 0 ? "profit" : value < 0 ? "loss" : "balanced";
}

function readMetrics(
  row: Record<string, unknown>,
  columns: ColumnMap,
  prefix = "",
): RawChannelMetrics {
  const columnFor = (key: string) => columns[prefix ? `${prefix}.${key}` : key];
  return {
    revenue: parseFinanceNumber(row[columnFor("revenue") ?? ""]),
    cogs: parseFinanceNumber(row[columnFor("cogs") ?? ""]),
    returnProvision: parseFinanceNumber(row[columnFor("returnProvision") ?? ""]),
    salarySaleCskh: parseFinanceNumber(row[columnFor("salarySaleCskh") ?? ""]),
    salaryOther: parseFinanceNumber(row[columnFor("salaryOther") ?? ""]),
    fixedCost: parseFinanceNumber(row[columnFor("fixedCost") ?? ""]),
    otherCost: parseFinanceNumber(row[columnFor("otherCost") ?? ""]),
    adsCost: parseFinanceNumber(row[columnFor("adsCost") ?? ""]),
    topRevenueProducts: parseProductMetrics(row[columnFor("topRevenueProducts") ?? ""]),
    topProfitProducts: parseProductMetrics(row[columnFor("topProfitProducts") ?? ""]),
  };
}

function normalizeRows(
  sheet: SheetData,
  format: "long" | "wide",
  columns: ColumnMap,
  warnings: string[],
): NormalizedManagementRow[] {
  const output: NormalizedManagementRow[] = [];
  let ignoredRows = 0;

  sheet.rows.forEach((row, rowIndex) => {
    const track = parseTrack(row[columns.type ?? ""]);
    if (!track) {
      ignoredRows += 1;
      return;
    }

    let parsedDate;
    try {
      parsedDate = parseFinanceDate(row[columns.date ?? ""] as string | number | Date);
    } catch (error) {
      throw new Error(
        `Dòng ${rowIndex + 2}: ${error instanceof Error ? error.message : "Ngày không hợp lệ."}`,
      );
    }

    if (format === "long") {
      const channel = parseChannel(row[columns.channel ?? ""]);
      if (!channel) {
        ignoredRows += 1;
        return;
      }
      output.push({
        date: parsedDate.iso,
        dateLabel: parsedDate.label,
        track,
        channel,
        metrics: readMetrics(row, columns),
      });
      return;
    }

    for (const channel of ["zalo", "page"] as const) {
      output.push({
        date: parsedDate.iso,
        dateLabel: parsedDate.label,
        track,
        channel,
        metrics: readMetrics(row, columns, channel),
      });
    }
  });

  if (ignoredRows) {
    warnings.push(`${ignoredRows} dòng bị bỏ qua vì Type hoặc Channel không hợp lệ.`);
  }
  if (!output.length) {
    throw new Error("Không có dòng Dự tính/Thực tế hợp lệ trong file.");
  }
  return output;
}

function buildDailySnapshots(
  rows: NormalizedManagementRow[],
  warnings: string[],
): DailyManagementSnapshot[] {
  const dates = Array.from(new Set(rows.map((row) => row.date))).sort();
  let cumulativeEstimated = emptyChannelSet();
  let cumulativeActual = emptyChannelSet();

  return dates.map((date) => {
    const dateRows = rows.filter((row) => row.date === date);
    const dateLabel = dateRows[0].dateLabel;
    const getMetrics = (track: ManagementTrack, channel: ManagementChannel) => {
      const matching = dateRows.filter(
        (row) => row.track === track && row.channel === channel,
      );
      if (!matching.length) {
        warnings.push(
          `${dateLabel}: thiếu ${track === "estimated" ? "Dự tính" : "Thực tế"} - ${channel === "zalo" ? "Zalo" : "Page"}; hệ thống dùng 0.`,
        );
        return emptyCalculatedMetrics();
      }
      return addMetrics(...matching.map((row) => calculateChannelMetrics(row.metrics)));
    };

    const estimated = createChannelSet(
      getMetrics("estimated", "zalo"),
      getMetrics("estimated", "page"),
    );
    const actual = createChannelSet(
      getMetrics("actual", "zalo"),
      getMetrics("actual", "page"),
    );
    cumulativeEstimated = addChannelSets(cumulativeEstimated, estimated);
    cumulativeActual = addChannelSets(cumulativeActual, actual);
    const revenueDifference =
      cumulativeActual.total.revenue - cumulativeEstimated.total.revenue;
    const profitDifference =
      cumulativeActual.total.profit - cumulativeEstimated.total.profit;

    return {
      date,
      dateLabel,
      estimated,
      actual,
      cumulative: {
        estimated: cumulativeEstimated,
        actual: cumulativeActual,
        revenueDifference,
        profitDifference,
        hiddenStatus: hiddenStatus(profitDifference),
      },
    };
  });
}

function formatMissingColumn(key: string) {
  const [channel, metric] = key.includes(".") ? key.split(".") : ["", key];
  const label = COLUMN_LABELS[metric] ?? metric;
  return channel ? `${channel === "zalo" ? "Zalo" : "Page"}_${label}` : label;
}

export async function parseFinancialManagementFile(
  file: File,
): Promise<ProcessedManagementReport> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["xlsx", "xls", "csv"].includes(extension)) {
    throw new Error("Chỉ hỗ trợ file .xlsx, .xls hoặc .csv.");
  }
  return parseFinancialManagementSheets(await readWorkbookSheets(await file.arrayBuffer()));
}

/** Picks the best-matching sheet (long or wide format) among the given sheets. */
export function parseFinancialManagementSheets(allSheets: SheetData[]): ProcessedManagementReport {
  const sheets: SheetData[] = allSheets.filter((sheet) => sheet.rows.length > 0);

  if (!sheets.length) throw new Error("File không có sheet dữ liệu hợp lệ.");

  const analyses = sheets.flatMap((sheet) => {
    const longColumns = mapLongColumns(sheet.headers);
    const wideColumns = mapWideColumns(sheet.headers);
    const longRequired = requiredLongKeys();
    const wideRequired = requiredWideKeys();
    return [
      {
        sheet,
        format: "long" as const,
        columns: longColumns,
        required: longRequired,
        score: longRequired.filter((key) => longColumns[key]).length / longRequired.length,
      },
      {
        sheet,
        format: "wide" as const,
        columns: wideColumns,
        required: wideRequired,
        score: wideRequired.filter((key) => wideColumns[key]).length / wideRequired.length,
      },
    ];
  }).sort((a, b) => b.score - a.score);

  const selected = analyses[0];
  const missing = selected.required.filter((key) => !selected.columns[key]);
  if (missing.length) {
    throw new Error(
      `Thiếu cột bắt buộc (${selected.format === "long" ? "long format" : "wide format"}): ${missing.map(formatMissingColumn).join(", ")}.`,
    );
  }

  const warnings: string[] = [];
  const missingProducts =
    selected.format === "long"
      ? PRODUCT_KEYS.filter((key) => !selected.columns[key])
      : (["zalo", "page"] as const).flatMap((channel) =>
          PRODUCT_KEYS.filter((key) => !selected.columns[`${channel}.${key}`]).map(
            (key) => `${channel}.${key}`,
          ),
        );
  if (missingProducts.length) {
    warnings.push("Thiếu một số cột Top Products; biểu đồ sản phẩm có thể không đầy đủ.");
  }

  const normalizedRows = normalizeRows(
    selected.sheet,
    selected.format,
    selected.columns,
    warnings,
  );
  const days = buildDailySnapshots(normalizedRows, warnings);
  const finalCumulative = days.at(-1)?.cumulative;
  if (!finalCumulative) throw new Error("Không thể tạo dữ liệu lũy kế.");

  const firstDay = days[0];
  const lastDay = days.at(-1) ?? firstDay;
  const profitDifference = finalCumulative.profitDifference;

  return {
    sourceSheet: selected.sheet.name,
    inputFormat: selected.format,
    days,
    summary: {
      dateFrom: firstDay.date,
      dateTo: lastDay.date,
      dateRangeLabel:
        firstDay.date === lastDay.date
          ? firstDay.dateLabel
          : `${firstDay.dateLabel} – ${lastDay.dateLabel}`,
      estimated: finalCumulative.estimated,
      actual: finalCumulative.actual,
      revenueDifference: finalCumulative.revenueDifference,
      profitDifference,
      hiddenStatus: hiddenStatus(profitDifference),
      topRevenueProducts: finalCumulative.actual.total.topRevenueProducts.slice(0, 5),
      topProfitProducts: finalCumulative.actual.total.topProfitProducts.slice(0, 5),
    },
    warnings: Array.from(new Set(warnings)),
  };
}

export function processNormalizedManagementRows(
  rows: NormalizedManagementRow[],
  sourceSheet = "Dữ liệu",
): ProcessedManagementReport {
  const warnings: string[] = [];
  const days = buildDailySnapshots(rows, warnings);
  const firstDay = days[0];
  const lastDay = days.at(-1);
  if (!firstDay || !lastDay) throw new Error("Không có dữ liệu để tạo báo cáo.");
  const cumulative = lastDay.cumulative;

  return {
    sourceSheet,
    inputFormat: "long",
    days,
    summary: {
      dateFrom: firstDay.date,
      dateTo: lastDay.date,
      dateRangeLabel:
        firstDay.date === lastDay.date
          ? firstDay.dateLabel
          : `${firstDay.dateLabel} – ${lastDay.dateLabel}`,
      estimated: cumulative.estimated,
      actual: cumulative.actual,
      revenueDifference: cumulative.revenueDifference,
      profitDifference: cumulative.profitDifference,
      hiddenStatus: cumulative.hiddenStatus,
      topRevenueProducts: cumulative.actual.total.topRevenueProducts.slice(0, 5),
      topProfitProducts: cumulative.actual.total.topProfitProducts.slice(0, 5),
    },
    warnings: Array.from(new Set(warnings)),
  };
}
