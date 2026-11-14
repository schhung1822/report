"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { PerformanceReportView } from "@/components/reports/performance-report-view";
import { PhFinanceView } from "@/components/reports/ph-finance-view";
import { VnManagementView } from "@/components/reports/vn-management-view";
import type { PrintPayload } from "@/lib/external/print-payload";
import { processPhilippinesRows } from "@/lib/philippines-report";
import { renderReportToPdfBlob } from "@/lib/report-export";

const NOOP = () => {};
const subscribe = () => NOOP;
const readPayload = () => window.__REPORT_PAYLOAD__ ?? null;
const serverPayload = () => null;
const PDF_MAX_BYTES = 29 * 1024 * 1024;

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Internal page for the external report API: a headless Chrome opens it with the report's data already in
 * window.__REPORT_PAYLOAD__, then asks it for the PDF (window.__makePdf), which is made by the same code as the
 * "Tải PDF" button. Nothing here is linked from the app.
 */
export default function PrintReportPage() {
  const reportRef = useRef<HTMLDivElement>(null);
  // Put there by the server before the page loads (it is not React state); the server render has none.
  const payload: PrintPayload | null = useSyncExternalStore(subscribe, readPayload, serverPayload);

  const phResult = useMemo(() => {
    if (payload?.type !== "ph") return null;
    try {
      return { report: processPhilippinesRows(payload.phRows, payload.rate) };
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : "Không thể xử lý dữ liệu Philippines." };
    }
  }, [payload]);
  const phReport = phResult?.report ?? null;
  const error = phResult?.error ?? null;

  const drawn = payload !== null && (payload.type !== "ph" || phReport !== null);
  useEffect(() => {
    if (!drawn) return;
    window.__makePdf = async (format) => {
      const blob = await renderReportToPdfBlob(reportRef.current, { format }, PDF_MAX_BYTES);
      return blobToBase64(blob);
    };
    document.fonts.ready.then(() => requestAnimationFrame(() => (window.__reportReady = true)));
    return () => {
      window.__reportReady = false;
    };
  }, [drawn]);

  if (error) return <p data-print-error>{error}</p>;
  if (!payload) return null;

  return (
    <div className="w-max bg-white">
      {payload.type === "performance" ? (
        <PerformanceReportView
          reportRef={reportRef}
          dailyRows={payload.dailyRows}
          cumulativeRows={payload.cumulativeRows}
          sharedCosts={payload.sharedCosts}
          reportDate={payload.reportDate}
          summary=""
          onSummaryChange={NOOP}
          exporting
        />
      ) : payload.type === "vn" ? (
        <VnManagementView reportRef={reportRef} report={payload.report} reconcile={payload.reconcile} />
      ) : phReport ? (
        <PhFinanceView
          reportRef={reportRef}
          report={phReport}
          reconcile={payload.reconcile}
          previousDay={payload.previousDay}
          refundTrend={payload.refundTrend}
          openOrders={payload.openOrders}
          mergedShops={payload.mergedShops}
        />
      ) : null}
    </div>
  );
}
