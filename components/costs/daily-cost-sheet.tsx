"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, FileSpreadsheet, LoaderCircle, Save, Trash2, Upload, X } from "lucide-react";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { DailyCostGrid } from "@/components/costs/daily-cost-grid";
import {
  buildSheetWorkbook,
  compareWithStored,
  parseSheetFile,
  SHEET_COLUMNS,
  sheetMarketOf,
  totalsByLine,
  type ParsedSheet,
  type SheetCell,
  type SheetMarket,
} from "@/lib/costs/daily-sheet";
import { toDmy } from "@/lib/pancake/dates";
import type { PancakeShop } from "@/lib/pancake/types";
import { triggerDownload } from "@/lib/report-export";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

function download(buffer: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_TYPE }));
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

type FileState = { name: string; parsed: ParsedSheet; compared: ReturnType<typeof compareWithStored> | null };

/**
 * The accountant's daily cost sheet: download the Excel template (blank, or filled with what is stored), fill it in, upload
 * it, check the preview and save. Saved days replace the estimates of the same day and kind in the reports. The date range
 * comes from the page (its "Khoảng ngày" panel).
 */
export function DailyCostSheet({
  shop,
  configured,
  from,
  to,
}: {
  shop: PancakeShop | undefined;
  configured: boolean | null;
  from: string;
  to: string;
}) {
  const market: SheetMarket = sheetMarketOf(shop?.currency);
  const unit = market === "PHP" ? "₱" : "₫";
  const columns = SHEET_COLUMNS[market];
  const money = useMemo(() => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }), []);
  const fileInput = useRef<HTMLInputElement>(null);

  const [stored, setStored] = useState<SheetCell[]>([]);
  const [loadedFor, setLoadedFor] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [file, setFile] = useState<FileState | null>(null);
  const [busy, setBusy] = useState<null | "template" | "export" | "read" | "save" | "delete">(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const shopId = shop?.id;
  const rangeValid = Boolean(from) && Boolean(to) && from <= to;
  const rangeKey = shopId && rangeValid ? `${shopId}|${from}|${to}|${reloadToken}` : "";
  const loading = Boolean(rangeKey) && loadedFor !== rangeKey;

  useEffect(() => {
    if (!rangeKey || !shopId || configured === false) return;
    let cancelled = false;
    request<{ configured: boolean; cells: SheetCell[] }>(`/api/costs/daily?shopId=${shopId}&from=${from}&to=${to}`)
      .then((result) => {
        if (cancelled) return;
        setStored(result.cells);
        setLoadedFor(rangeKey);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStored([]);
        setLoadedFor(rangeKey);
        setNotice({ type: "error", message: error instanceof Error ? error.message : "Không đọc được bảng chi phí theo ngày." });
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey, shopId, from, to, configured]);

  const baseName = `chi-phi-ke-toan-${market === "PHP" ? "phil" : "viet"}`;

  async function downloadTemplate(withStored: boolean) {
    if (!shop || !rangeValid) return;
    setBusy(withStored ? "export" : "template");
    setNotice(null);
    try {
      const cells = withStored ? stored : [];
      download(await buildSheetWorkbook(market, from, to, cells), `${baseName}-${from}_${to}${withStored ? "" : "-mau"}.xlsx`);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không tạo được file." });
    } finally {
      setBusy(null);
    }
  }

  async function readFile(selected: File | undefined) {
    if (!selected || !shop) return;
    const extension = selected.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["xlsx", "xls", "csv"].includes(extension)) {
      setNotice({ type: "error", message: "File phải là .xlsx, .xls hoặc .csv." });
      return;
    }
    setBusy("read");
    setNotice(null);
    setFile(null);
    try {
      const parsed = await parseSheetFile(await selected.arrayBuffer(), extension, market);
      let compared: FileState["compared"] = null;
      if (!parsed.errors.length && parsed.days.length) {
        try {
          const first = parsed.days[0];
          const last = parsed.days[parsed.days.length - 1];
          const result = await request<{ cells: SheetCell[] }>(`/api/costs/daily?shopId=${shop.id}&from=${first}&to=${last}`);
          compared = compareWithStored(parsed.cells, result.cells);
        } catch {
          compared = null;
        }
      }
      setFile({ name: selected.name, parsed, compared });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không đọc được file." });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveCells(cells: SheetCell[], dayCount: number): Promise<boolean> {
    if (!shop || !cells.length) return false;
    setBusy("save");
    setNotice(null);
    try {
      const result = await request<{ saved: number }>("/api/costs/daily", {
        method: "POST",
        body: JSON.stringify({ shopId: shop.id, market, cells }),
      });
      setNotice({
        type: "success",
        message: `Đã lưu ${result.saved} ô chi phí của ${dayCount} ngày. Lấy lại dữ liệu ở trang báo cáo để áp dụng.`,
      });
      setReloadToken((token) => token + 1);
      return true;
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không lưu được bảng chi phí." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!file || file.parsed.errors.length) return;
    if (await saveCells(file.parsed.cells, file.parsed.days.length)) setFile(null);
  }

  async function removeRange() {
    if (!shop || !rangeValid || !stored.length) return;
    if (!window.confirm(`Xoá toàn bộ số chi phí kế toán đã lưu của ${shop.name} từ ${toDmy(from)} đến ${toDmy(to)}?`)) return;
    setBusy("delete");
    setNotice(null);
    try {
      const result = await request<{ deleted: number }>(`/api/costs/daily?shopId=${shop.id}&from=${from}&to=${to}`, { method: "DELETE" });
      setNotice({ type: "success", message: `Đã xoá ${result.deleted} ô chi phí.` });
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không xoá được." });
    } finally {
      setBusy(null);
    }
  }

  const disabled = !shop || configured === false || busy !== null;
  const totals = file ? totalsByLine(file.parsed.cells) : null;

  return (
    <div className="space-y-3">
      <Notice notice={notice} />

      <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-2">
        <div>
          <p className="font-medium">Tự động, không cần nhập</p>
          <p className="mt-0.5 text-muted-foreground">
            {market === "PHP"
              ? "Doanh thu và số đơn (Pancake POS), chi phí ads (Ads Meta), tỷ giá (trang Tỷ giá). Lương nhập ở tab “Lương nhân sự”."
              : "Doanh thu, giá vốn, phí vận chuyển (Pancake POS), chi phí ads (Ads Meta). Lương nhập ở tab “Lương nhân sự”."}
          </p>
        </div>
        <div>
          <p className="font-medium">Cần nhập ở bảng dưới (tiền {market === "PHP" ? "peso ₱" : "đồng ₫"}, mỗi ngày{market === "VND" ? " và kênh" : ""})</p>
          <p className="mt-0.5 text-muted-foreground">
            {market === "PHP"
              ? "Giá vốn (POS Phil không có) tự tính theo danh mục khi đã đặt giá vốn trung bình ở tab “Giá vốn theo danh mục”; nếu chưa thì cần nhập để lợi nhuận đúng. Dịch vụ mua ngoài, giao hàng, chi phí khác, thuế/phí tự tính theo số sản phẩm bán ra × đơn giá ở tab “Đơn giá theo sản phẩm”; chỉ nhập khi ngày đó khác mức thường."
              : "Giá vốn hoàn, chi phí cố định và chi phí khác của từng kênh. Không nhập thì báo cáo dùng số ước tính hằng tháng."}{" "}
            Muốn nhập ngay trên bảng lợi nhuận cả tháng (thấy lợi nhuận đổi theo từng số):{" "}
            <Link href="/pnl" className="font-medium text-foreground underline">
              Bảng lợi nhuận
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rangeValid ? (
            <span className="font-medium text-foreground">
              {toDmy(from)} – {toDmy(to)}
            </span>
          ) : (
            from ? <span className="text-destructive">Khoảng ngày chưa hợp lệ.</span> : null
          )}{" "}
          Ô vàng là ô vừa sửa, ô xám là số đã lưu. Excel dùng khi cần nhập nhiều tháng một lần:
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" disabled={disabled || !rangeValid} onClick={() => void downloadTemplate(false)}>
            {busy === "template" ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}
            Tải file mẫu
          </Button>
          <Button variant="outline" size="sm" disabled={disabled || !rangeValid || !stored.length} onClick={() => void downloadTemplate(true)}>
            {busy === "export" ? <LoaderCircle className="animate-spin" /> : <Download />}
            Xuất số đã lưu
          </Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => fileInput.current?.click()}>
            {busy === "read" ? <LoaderCircle className="animate-spin" /> : <Upload />}
            Nhập file Excel
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            aria-label="File chi phí kế toán"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <details className="group rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between font-medium [&::-webkit-details-marker]:hidden">
          Ý nghĩa các cột và mẹo nhập nhanh
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Gõ số vào ô, Enter hoặc phím ↓ xuống ngày kế tiếp. Số cũ tự hiện sẵn, sửa được.</li>
            <li>
              Đang có bảng tính (Excel, Google Sheets)? Copy cả khối ô rồi dán vào ô đầu tiên: số điền theo đúng hàng và cột. Nhớ để thứ tự cột giống bảng này.
            </li>
            <li>Ô để trống = giữ nguyên số đã lưu; gõ 0 = lưu là 0. Lưu lại cùng ngày thì ghi đè, không cộng dồn.</li>
            <li>Ngày nào có số cho một khoản thì thay cho số ước tính hằng tháng của đúng ngày và khoản đó.</li>
          </ul>
          <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {columns.map((column) => (
              <li key={column.line}>
                <span className="font-medium text-foreground">{column.header}</span>: {column.hint}
              </li>
            ))}
          </ul>
        </div>
      </details>

      {file ? (
        <div className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Xem trước <span className="font-normal text-muted-foreground">· {file.name}</span>
            </p>
            <Button variant="ghost" size="xs" onClick={() => setFile(null)} disabled={busy !== null}>
              <X />
              Bỏ file
            </Button>
          </div>

          {file.parsed.errors.length ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
              <p className="font-medium">Chưa lưu được, cần sửa {file.parsed.errors.length} lỗi trong file:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {file.parsed.errors.slice(0, 12).map((error) => (
                  <li key={error}>{error}</li>
                ))}
                {file.parsed.errors.length > 12 ? <li>… và {file.parsed.errors.length - 12} lỗi khác</li> : null}
              </ul>
            </div>
          ) : (
            <>
              <p className="text-xs">
                <strong>{file.parsed.days.length}</strong> ngày ({toDmy(file.parsed.days[0])}
                {file.parsed.days.length > 1 ? ` – ${toDmy(file.parsed.days[file.parsed.days.length - 1])}` : ""}), <strong>{file.parsed.cells.length}</strong> ô có số
                {file.compared ? (
                  <>
                    : <strong>{file.compared.added}</strong> mới, <strong className={file.compared.changed ? "text-amber-700" : undefined}>{file.compared.changed}</strong> ghi đè số khác,{" "}
                    {file.compared.same} giữ nguyên.
                  </>
                ) : (
                  "."
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {columns.map((column) => (
                  <div key={column.line} className="rounded-md border bg-background px-2.5 py-1 text-[11px]">
                    <span className="text-muted-foreground">{column.header}</span>
                    <span className="ml-1.5 font-medium tabular-nums">
                      {money.format(totals?.get(column.line) ?? 0)} {unit}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {file.parsed.notes.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-muted-foreground">
              {file.parsed.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex justify-end">
            <Button size="sm" disabled={busy !== null || file.parsed.errors.length > 0 || !shop} onClick={() => void save()}>
              {busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}
              Lưu vào MySQL
            </Button>
          </div>
        </div>
      ) : null}

      <DailyCostGrid
        market={market}
        from={from}
        to={to}
        stored={stored}
        loading={loading}
        disabled={disabled}
        saving={busy === "save"}
        onSave={(cells) => saveCells(cells, new Set(cells.map((cell) => cell.date)).size)}
        money={money}
        unit={unit}
      />

      <div className="flex justify-end">
        <Button variant="ghost" size="xs" disabled={disabled || !stored.length} onClick={() => void removeRange()}>
          {busy === "delete" ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
          Xoá toàn bộ số đã lưu trong khoảng ngày
        </Button>
      </div>
    </div>
  );
}
