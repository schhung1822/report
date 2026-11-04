"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, LoaderCircle, Save, Trash2, Upload, X } from "lucide-react";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  buildSheetWorkbook,
  CHANNEL_NAME,
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

  // Stored cells grouped into the rows of the template: one per day (and channel).
  const storedRows = useMemo(() => {
    const rows = new Map<string, { date: string; channel: SheetCell["channel"]; values: Map<string, number> }>();
    for (const cell of stored) {
      const key = `${cell.date}|${cell.channel}`;
      const row = rows.get(key) ?? { date: cell.date, channel: cell.channel, values: new Map<string, number>() };
      row.values.set(cell.line, cell.amount);
      rows.set(key, row);
    }
    return Array.from(rows.values()).sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel));
  }, [stored]);

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

  async function save() {
    if (!shop || !file || file.parsed.errors.length) return;
    setBusy("save");
    setNotice(null);
    try {
      const result = await request<{ saved: number }>("/api/costs/daily", {
        method: "POST",
        body: JSON.stringify({ shopId: shop.id, market, cells: file.parsed.cells }),
      });
      setNotice({
        type: "success",
        message: `Đã lưu ${result.saved} ô chi phí của ${file.parsed.days.length} ngày. Lấy lại dữ liệu ở trang báo cáo để áp dụng.`,
      });
      setFile(null);
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không lưu được bảng chi phí." });
    } finally {
      setBusy(null);
    }
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {market === "PHP" ? "Mỗi ngày 1 dòng, tiền peso (₱)." : "Mỗi ngày 2 dòng Zalo và Page, tiền đồng (₫)."}{" "}
          {rangeValid ? (
            <span className="font-medium text-foreground">
              {toDmy(from)} – {toDmy(to)}
            </span>
          ) : (
            from ? <span className="text-destructive">Khoảng ngày chưa hợp lệ.</span> : null
          )}
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
          <Button size="sm" disabled={disabled} onClick={() => fileInput.current?.click()}>
            {busy === "read" ? <LoaderCircle className="animate-spin" /> : <Upload />}
            Nhập file đã điền
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
          Cách dùng và các cột của file
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              Chọn khoảng ngày, bấm <strong className="text-foreground">Tải file mẫu</strong> (hoặc <strong className="text-foreground">Xuất số đã lưu</strong> để sửa tiếp).
            </li>
            <li>Kế toán điền số vào file. Ô để trống = giữ nguyên số đã lưu; điền 0 = lưu là 0.</li>
            <li>
              Bấm <strong className="text-foreground">Nhập file đã điền</strong>, xem trước rồi lưu. Nhập lại cùng ngày thì ghi đè, không cộng dồn.
            </li>
          </ol>
          <p>
            Lương nhập ở tab <strong className="text-foreground">Lương nhân sự</strong>; chi phí ads tự lấy từ Ads Meta, nên hai khoản này không có trong file.
          </p>
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">
            Đã lưu
            <span className="ml-2 font-normal text-muted-foreground">{loading ? "Đang tải…" : `${new Set(stored.map((cell) => cell.date)).size} ngày có số trong khoảng`}</span>
          </p>
          <Button variant="ghost" size="xs" disabled={disabled || !stored.length} onClick={() => void removeRange()}>
            {busy === "delete" ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            Xoá số đã lưu trong khoảng
          </Button>
        </div>
        {storedRows.length ? (
          <div className="max-h-[32rem] overflow-auto rounded-lg border">
            <Table className="text-xs">
              <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ngày</TableHead>
                  {market === "VND" ? <TableHead>Kênh</TableHead> : null}
                  {columns.map((column) => (
                    <TableHead key={column.line} className="text-right">
                      {column.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="[&_td]:px-3 [&_td]:py-1.5">
                {storedRows.map((row) => (
                  <TableRow key={`${row.date}|${row.channel}`}>
                    <TableCell className="font-medium">{toDmy(row.date)}</TableCell>
                    {market === "VND" ? <TableCell>{row.channel ? CHANNEL_NAME[row.channel] : "Cả shop"}</TableCell> : null}
                    {columns.map((column) => (
                      <TableCell key={column.line} className="text-right tabular-nums">
                        {row.values.has(column.line) ? money.format(row.values.get(column.line) as number) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            {loading ? "Đang tải…" : "Chưa có số kế toán trong khoảng ngày này. Bấm “Tải file mẫu” để bắt đầu."}
          </p>
        )}
      </div>
    </div>
  );
}
