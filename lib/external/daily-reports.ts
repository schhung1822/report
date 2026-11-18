// Server-only: the whole job behind the external API. Reads the day from Pancake POS (the same way the consolidated report
// page does for "all shops"), draws the Hiệu suất / Quản trị Việt / Quản trị Phil reports as PDFs and posts them to Lark.
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import {
  EXTERNAL_REPORT_LABELS,
  type ExternalReportKey,
  type PrintPayload,
} from "@/lib/external/print-payload";
import { openRenderer } from "@/lib/external/render-pdf";
import { LarkError, readLarkConfig, sendPdfToChat } from "@/lib/lark";
import { saveSnapshot } from "@/lib/history/repository";
import { mergeablePhResults, mergeOpenOrders, mergePhRows, mergePreviousDay, mergeRefundTrend } from "@/lib/pancake/merge-ph";
import { PancakeError } from "@/lib/pancake/mcp-client";
import { fetchShops, syncFromPancake } from "@/lib/pancake/sync";
import type { PancakeShop, PancakeSyncResult } from "@/lib/pancake/types";
import { toDmy } from "@/lib/pancake/dates";
import { PH_DEFAULT_EXCHANGE_RATE } from "@/lib/philippines-report";
import { REPORT_FILE_PREFIX, reportFileDate } from "@/lib/report-filename";
import { POS_SOURCE_SHEET } from "@/types/financial-management";

export class ExternalJobError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type ReportOutcome = {
  key: ExternalReportKey;
  label: string;
  shop?: string;
  status: "sent" | "failed" | "skipped";
  filename?: string;
  sizeBytes?: number;
  messageId?: string | null;
  message?: string;
};

export type DailyReportsResult = {
  range: { from: string; to: string };
  reports: ReportOutcome[];
  warnings: string[];
};

type Job = { key: ExternalReportKey; shop: string; filename: string; payload: PrintPayload };

const errorText = (error: unknown) => (error instanceof Error ? error.message : "lỗi không xác định");

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const FILE_PREFIX: Record<ExternalReportKey, string> = {
  performance: REPORT_FILE_PREFIX.performance,
  vn: REPORT_FILE_PREFIX.vn,
  ph: REPORT_FILE_PREFIX.ph,
};

/** Plans the PDFs from the shops' results: Vietnam shops give Hiệu suất and Quản trị Việt, Philippines shops (added together) Quản trị Phil. */
function planJobs(results: PancakeSyncResult[], tag: string, outcomes: ReportOutcome[]) {
  const jobs: Job[] = [];
  const vnResults = results.filter((result) => result.shop.currency.toUpperCase() === "VND").sort((a, b) => a.shop.id - b.shop.id);
  const nameOf = (result: PancakeSyncResult) => (vnResults.length > 1 ? `-${slug(result.shop.name)}` : "");

  for (const result of vnResults) {
    if (result.performance) {
      jobs.push({
        key: "performance",
        shop: result.shop.name,
        filename: `${FILE_PREFIX.performance}${nameOf(result)}-${tag}.pdf`,
        payload: { type: "performance", ...result.performance },
      });
    } else {
      outcomes.push({ key: "performance", label: EXTERNAL_REPORT_LABELS.performance, shop: result.shop.name, status: "skipped", message: "Pancake POS chưa có đơn nào trong ngày." });
    }
    if (result.vn) {
      jobs.push({
        key: "vn",
        shop: result.shop.name,
        filename: `${FILE_PREFIX.vn}${nameOf(result)}-${tag}.pdf`,
        payload: {
          type: "vn",
          report: result.vn,
          // Only a report built from the POS can be reconciled with it.
          reconcile: result.vn.sourceSheet === POS_SOURCE_SHEET ? { shopId: result.shop.id, to: result.range.to } : undefined,
        },
      });
    } else {
      outcomes.push({ key: "vn", label: EXTERNAL_REPORT_LABELS.vn, shop: result.shop.name, status: "skipped", message: "Pancake POS chưa có đơn nào trong ngày." });
    }
  }

  const phGroup = mergeablePhResults(results);
  if (phGroup.length) {
    const merged = phGroup.length > 1;
    const first = phGroup[0];
    jobs.push({
      key: "ph",
      shop: phGroup.map((result) => result.shop.name).join(" + "),
      filename: `${FILE_PREFIX.ph}-${tag}.pdf`,
      payload: {
        type: "ph",
        phRows: merged ? mergePhRows(phGroup.map((result) => result.phRows ?? [])) : (first.phRows ?? []),
        rate: first.exchangeRate?.rate ?? PH_DEFAULT_EXCHANGE_RATE,
        reconcile: { shopId: merged ? phGroup.map((result) => result.shop.id) : first.shop.id, to: first.range.to },
        previousDay: merged ? mergePreviousDay(phGroup.map((result) => result.previousDay)) : first.previousDay,
        refundTrend: merged ? mergeRefundTrend(phGroup.map((result) => result.refundTrend)) : first.refundTrend,
        openOrders: merged ? mergeOpenOrders(phGroup.map((result) => result.openOrders)) : first.openOrders,
        mergedShops: merged ? phGroup.map((result) => result.shop.name) : undefined,
      },
    });
  }
  return jobs;
}

/**
 * Creates the reports of the days from..to (YYYY-MM-DD, already validated) and posts the three PDFs to the Lark group.
 * A report that fails does not stop the others; each one's outcome is in the result. Throws ExternalJobError only when
 * nothing can be attempted (Lark or the Pancake shop list not available).
 */
export async function runDailyReports({ from, to }: { from: string; to: string }): Promise<DailyReportsResult> {
  const larkConfig = readLarkConfig();
  if ("missing" in larkConfig) {
    throw new ExternalJobError(`Chưa cấu hình Lark: thiếu ${larkConfig.missing.join(", ")} trong file .env.`, 503);
  }

  let shops: PancakeShop[];
  const warnings: string[] = [];
  try {
    const listed = await fetchShops();
    shops = listed.shops.filter((shop) => ["VND", "PHP"].includes(shop.currency.toUpperCase()));
    warnings.push(...listed.problems.map((problem) => `API key Pancake lỗi — ${problem}`));
  } catch (error) {
    throw new ExternalJobError(`Không lấy được danh sách shop từ Pancake POS: ${errorText(error)}`, error instanceof PancakeError ? error.status : 502);
  }
  if (!shops.length) throw new ExternalJobError("Không có shop VND hoặc PHP nào để tạo báo cáo.", 404);

  // 1. Read every shop (a failing shop is reported, the others still go on).
  const results: PancakeSyncResult[] = [];
  const syncErrors: { currency: string; shop: string; message: string }[] = [];
  await Promise.all(
    shops.map(async (shop) => {
      try {
        const result = await syncFromPancake({ from, to, shopId: shop.id });
        if (isMysqlConfigured()) {
          // Same as the report page: keep the report in the history. Failing to store it must not lose the report.
          try {
            await saveSnapshot(result, "api");
          } catch (error) {
            warnings.push(`${shop.name}: không lưu được vào lịch sử báo cáo (${error instanceof CostDbError ? error.message : errorText(error)}).`);
          }
        }
        warnings.push(...result.warnings.map((warning) => `${shop.name}: ${warning}`));
        results.push(result);
      } catch (error) {
        syncErrors.push({ currency: shop.currency.toUpperCase(), shop: shop.name, message: errorText(error) });
      }
    }),
  );

  // 2. Plan the PDFs. Whatever cannot be made is listed with the reason.
  const tag = from === to ? reportFileDate(toDmy(from)) : `${reportFileDate(toDmy(from))}_${reportFileDate(toDmy(to))}`;
  const outcomes: ReportOutcome[] = [];
  const jobs = planJobs(results, tag, outcomes);
  const wanted: { key: ExternalReportKey; currency: string }[] = [
    { key: "performance", currency: "VND" },
    { key: "vn", currency: "VND" },
    { key: "ph", currency: "PHP" },
  ];
  for (const { key, currency } of wanted) {
    const known = jobs.some((job) => job.key === key) || outcomes.some((outcome) => outcome.key === key);
    if (known) continue;
    const failures = syncErrors.filter((item) => item.currency === currency);
    outcomes.push({
      key,
      label: EXTERNAL_REPORT_LABELS[key],
      status: failures.length ? "failed" : "skipped",
      message: failures.length
        ? failures.map((item) => `${item.shop}: ${item.message}`).join("; ")
        : `Không có shop ${currency === "VND" ? "Việt Nam (VND)" : "Philippines (PHP)"} nào.`,
    });
  }
  // A shop failing next to a working one of the same currency is not in the list above: mention it here.
  for (const item of syncErrors) {
    if (!results.some((result) => result.shop.currency.toUpperCase() === item.currency)) continue;
    warnings.push(`${item.shop}: không lấy được dữ liệu — ${item.message}`);
  }

  // 3. Draw each report in a headless Chrome and post the PDF to Lark.
  if (jobs.length) {
    let renderer: Awaited<ReturnType<typeof openRenderer>> | null = null;
    let openError: string | null = null;
    try {
      renderer = await openRenderer();
    } catch (error) {
      openError = errorText(error);
    }
    try {
      for (const job of jobs) {
        const base = { key: job.key, label: EXTERNAL_REPORT_LABELS[job.key], shop: job.shop, filename: job.filename };
        if (!renderer) {
          outcomes.push({ ...base, status: "failed", message: openError ?? "Không dựng được báo cáo." });
          continue;
        }
        try {
          const { pdf, warnings: drawWarnings } = await renderer.render(job.key, job.payload);
          warnings.push(...drawWarnings.map((warning) => `${EXTERNAL_REPORT_LABELS[job.key]}: ${warning}`));
          const messageId = await sendPdfToChat(larkConfig.config, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), job.filename, crypto.randomUUID());
          outcomes.push({ ...base, status: "sent", sizeBytes: pdf.length, messageId });
        } catch (error) {
          outcomes.push({ ...base, status: "failed", message: error instanceof LarkError ? `Gửi Lark thất bại: ${error.message}` : errorText(error) });
        }
      }
    } finally {
      await renderer?.close();
    }
  }

  const order: ExternalReportKey[] = ["performance", "vn", "ph"];
  outcomes.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { range: { from, to }, reports: outcomes, warnings };
}
