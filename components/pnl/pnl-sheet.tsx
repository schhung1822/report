"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ChevronDown, Columns3, FileText, LoaderCircle, PencilLine, RefreshCw, Save, Undo2 } from "lucide-react";
import { Notice, type NoticeState } from "@/components/notice";
import { parentLabel, PnlReport } from "@/components/pnl/pnl-report";
import { ExportButtons, PageHeader, ReportViewport } from "@/components/report-ui";
import { SendToLarkButton } from "@/components/send-to-lark-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAmountText, parseAmountText, sheetMarketOf, type SheetCell, type SheetChannel, type SheetLine, type SheetMarket } from "@/lib/costs/daily-sheet";
import { listDays, toDmy } from "@/lib/pancake/dates";
import type { PancakeShop } from "@/lib/pancake/types";
import type { StoredPnlDay } from "@/lib/pnl/repository";
import { computePnl, PNL_ROWS, type PnlCell, type PnlDayValues, type PnlRow, type PnlSource, type PnlStyle } from "@/lib/pnl/sheet";
import { localDate } from "@/lib/range-presets";
import {
  larkSentMessage,
  renderReportToPng,
  safeFilePart,
  saveReportAsPdf,
  sendReportToLark,
  triggerDownload,
  type LarkFormat,
} from "@/lib/report-export";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const DATE_WIDTH = 92;

/** Header and total colours of a column, like the accountant's Excel (sales green, costs yellow, profits blue). */
const COLUMN_STYLE: Record<PnlStyle, string> = {
  revenue: "bg-emerald-50 font-semibold",
  major: "bg-amber-50 font-semibold",
  result: "bg-sky-50 font-semibold",
  line: "bg-muted/60",
  detail: "bg-muted/60 font-normal text-muted-foreground",
  ratio: "bg-muted/60 font-normal text-muted-foreground",
};

const SOURCE_STYLE: Record<PnlSource, string> = {
  POS: "border-slate-300 text-slate-600",
  Meta: "border-blue-300 text-blue-700",
  Lương: "border-violet-300 text-violet-700",
  Nhập: "border-amber-400 bg-amber-50 text-amber-800",
};

/** The short set of columns: totals, ads and profits. */
const isCompactColumn = (row: PnlRow) =>
  row.style === "revenue" || row.style === "major" || row.style === "result" || row.id === "8.1" || row.id === "ads-ratio";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

const cellKey = (date: string, channel: SheetChannel, line: SheetLine) => `${date}|${channel}|${line}`;

const noopSubscribe = () => () => {};

/** First and last day of a month ("YYYY-MM"), the last one capped at today. Null for a month that has not started. */
function monthRange(month: string, today: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const from = `${month}-01`;
  if (from > today) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const last = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
  return { from, to: last < today ? last : today };
}

type View = "report" | "input";
/** The hidden columns of each view and kind of shop; null = never chosen, so the view's default applies. */
type HiddenColumns = Record<View, Record<SheetMarket, string[] | null>>;

// The input view keeps the key it had before the report view existed, so a choice made then still applies.
const HIDDEN_KEY = (view: View, market: SheetMarket) => (view === "input" ? `pnl-hidden-columns-${market}` : `pnl-report-hidden-columns-${market}`);

function readHidden(): HiddenColumns {
  const hidden: HiddenColumns = {
    report: { VND: null, PHP: null },
    input: { VND: null, PHP: null },
  };
  if (typeof window === "undefined") return hidden;
  for (const view of ["report", "input"] as const) {
    for (const market of ["VND", "PHP"] as const) {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_KEY(view, market)) ?? "null");
        if (Array.isArray(parsed)) hidden[view][market] = parsed.filter((id): id is string => typeof id === "string");
      } catch {
        // No storage (private window, blocked site data): the view's default columns show.
      }
    }
  }
  return hidden;
}

/** Until a choice is made the report leaves out the per-channel and per-route detail; the input view shows everything. */
const defaultHidden = (view: View, rows: PnlRow[]) => (view === "report" ? rows.filter((row) => row.style === "detail").map((row) => row.id) : []);

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

type Loaded = {
  key: string;
  days: StoredPnlDay[];
  cells: SheetCell[];
  /** False when MySQL is not configured: nothing is kept between visits. */
  configured: boolean;
  error: string | null;
};

/**
 * The monthly profit sheet: one row per day, one column per line of the income statement. The figures the system knows
 * (sales, cost of goods in Vietnam, Meta ads, staff pay) are kept in MySQL per day, so opening the page reads the POS only
 * for the days not read yet (or read before they ended); "Cập nhật dữ liệu POS" reads the whole month again. The lines
 * only the accountant knows are typed into the sheet and saved to the daily cost sheet, so every report uses them.
 */
export function PnlSheet() {
  // Today's date must not be read while the page is prerendered: it is empty on the server and the real date in the browser.
  // Until the user picks a month, the current one is shown.
  const today = useSyncExternalStore(noopSubscribe, () => localDate(), () => "");
  const [shops, setShops] = useState<PancakeShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [pickedMonth, setMonth] = useState<string | null>(null);
  const month = pickedMonth ?? today.slice(0, 7);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [hidden, setHidden] = useState(readHidden);
  const [view, setView] = useState<View>("input");
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const shop = shops.find((item) => String(item.id) === shopId);
  const market = sheetMarketOf(shop?.currency);
  const unit = market === "PHP" ? "₱" : "₫";
  const range = monthRange(month, today);
  const rangeFrom = range?.from ?? "";
  const rangeTo = range?.to ?? "";
  const shopNumber = shop?.id ?? 0;
  const loadKey = shopNumber && rangeFrom ? `${shopNumber}|${rangeFrom}|${rangeTo}` : "";
  const current = loaded?.key === loadKey ? loaded : null;
  const loading = Boolean(loadKey) && !current;
  const money = useMemo(() => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }), []);

  useEffect(() => {
    let cancelled = false;
    request<{ shops: PancakeShop[]; defaultShopId: number | null }>("/api/pancake/shops", { method: "POST", body: "{}" })
      .then(({ shops: list, defaultShopId }) => {
        if (cancelled) return;
        setShops(list);
        setShopId(String((list.find((item) => item.id === defaultShopId) ?? list[0])?.id ?? ""));
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setNotice({
            type: "error",
            message: error instanceof Error ? error.message : "Không tải được danh sách shop.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Reads `from`..`to` from the POS again (it is stored on the way) and puts the days into the sheet being shown. */
  async function refresh(key: string, shop: number, from: string, to: string) {
    setRefreshing({ from, to });
    try {
      const result = await request<{
        days: StoredPnlDay[];
        warnings: string[];
      }>("/api/pnl", {
        method: "POST",
        body: JSON.stringify({ shopId: shop, from, to }),
      });
      const fresh = new Map(result.days.map((day) => [day.date, day]));
      setLoaded((previous) => {
        if (!previous || previous.key !== key) return previous;
        const merged = new Map(previous.days.map((day) => [day.date, day]));
        for (const [date, day] of fresh) merged.set(date, day);
        return {
          ...previous,
          days: Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date)),
        };
      });
      setWarnings(result.warnings);
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Không lấy được dữ liệu từ POS.",
      });
    } finally {
      setRefreshing(null);
    }
  }

  useEffect(() => {
    if (!loadKey) return;
    let cancelled = false;
    Promise.all([
      request<{
        configured: boolean;
        days: StoredPnlDay[];
        fetchRange: { from: string; to: string } | null;
      }>(`/api/pnl?shopId=${shopNumber}&from=${rangeFrom}&to=${rangeTo}`),
      request<{ cells: SheetCell[] }>(`/api/costs/daily?shopId=${shopNumber}&from=${rangeFrom}&to=${rangeTo}`).then((result) => result.cells),
    ])
      .then(([stored, cells]) => {
        if (cancelled) return;
        setLoaded({
          key: loadKey,
          days: stored.days,
          cells,
          configured: stored.configured,
          error: null,
        });
        setWarnings([]);
        if (stored.fetchRange) void refresh(loadKey, shopNumber, stored.fetchRange.from, stored.fetchRange.to);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoaded({
            key: loadKey,
            days: [],
            cells: [],
            configured: true,
            error: error instanceof Error ? error.message : "Không đọc được số liệu.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [loadKey, shopNumber, rangeFrom, rangeTo]);

  // The React Compiler memoizes what follows, so it is written as plain computations.
  const rows = PNL_ROWS[market];
  const hiddenList = hidden[view][market] ?? defaultHidden(view, rows);
  const hiddenIds = new Set(hiddenList);
  const columns = rows.filter((row) => !hiddenIds.has(row.id));
  const inputColumns = columns.filter((row) => row.input);
  const days = rangeFrom ? listDays(rangeFrom, rangeTo) : [];
  const storedDays = current?.days ?? [];
  const reportValues = new Map<string, PnlDayValues>(storedDays.map((day) => [day.date, day.values]));
  const stored = new Map((current?.cells ?? []).map((cell) => [cellKey(cell.date, cell.channel, cell.line), cell.amount]));

  const cellOf = (date: string, line: SheetLine, channel: SheetChannel): PnlCell | undefined => {
    const key = cellKey(date, channel, line);
    const text = drafts[key]?.trim() ?? "";
    if (text !== "" && isAmountText(text)) return { amount: parseAmountText(text), typed: true };
    const amount = stored.get(key);
    return amount === undefined ? undefined : { amount, typed: false };
  };
  const computed = computePnl(rows, days, reportValues, cellOf);
  /** What the report uses for a typed line when its cell is empty: shown faintly in the empty cell. */
  const fallback = computePnl(rows, days, reportValues, () => undefined);

  /** Typed cells that differ from what is stored, and how many typed cells are not numbers. */
  const changes: SheetCell[] = [];
  let invalid = 0;
  for (const [key, raw] of Object.entries(drafts)) {
    const text = raw.trim();
    if (text === "") continue;
    if (!isAmountText(text)) {
      invalid += 1;
      continue;
    }
    const [date, channel, line] = key.split("|") as [string, SheetChannel, SheetLine];
    const amount = parseAmountText(text);
    if (stored.get(key) !== amount) changes.push({ date, channel, line, amount });
  }

  // Days that sold something but have no cost of goods / shipping: their profit is too high (the Philippines POS has neither).
  const revenueByDay = computed.byDay.get("1") ?? [];
  const sellingDays = revenueByDay.filter((value) => value > 0).length;
  const coverage =
    market === "PHP"
      ? [
          { label: "Giá vốn", id: "4" },
          { label: "Phí giao hàng", id: "8.3" },
        ].map((item) => ({
          ...item,
          covered: revenueByDay.filter((value, index) => value > 0 && (computed.byDay.get(item.id)?.[index] ?? 0) > 0).length,
        }))
      : [];

  const fetchedTimes = storedDays.map((day) => day.fetchedAt).sort();

  function setColumns(next: string[]) {
    setHidden((previous) => ({
      ...previous,
      [view]: { ...previous[view], [market]: next },
    }));
    try {
      window.localStorage.setItem(HIDDEN_KEY(view, market), JSON.stringify(next));
    } catch {
      // Not remembered on this browser; the choice still applies until the page is closed.
    }
  }

  function confirmLeave() {
    return !Object.keys(drafts).length || window.confirm("Có số đã gõ nhưng chưa lưu. Bỏ các số này?");
  }

  const fileBase = () => `bao-cao-loi-nhuan-${safeFilePart(shop?.name ?? "shop")}-${month}`;
  const reportName = `Báo cáo lợi nhuận theo ngày · ${shop?.name ?? ""}`;

  /**
   * The report view is what is exported. It is put on the page first (synchronously, so the picture is taken of it), and
   * numbers typed but not saved are shown in it, so the user is asked first.
   */
  async function exportReport(kind: "image" | "pdf" | "lark", work: (element: HTMLDivElement | null) => Promise<void>) {
    if (
      changes.length &&
      !window.confirm(`Có ${changes.length} ô đã gõ nhưng chưa lưu; ${kind === "lark" ? "ảnh gửi đi" : "file xuất ra"} sẽ dùng các số này. Tiếp tục?`)
    )
      return;
    flushSync(() => {
      setView("report");
      setExporting(kind === "pdf" ? "pdf" : "image");
    });
    try {
      await work(reportRef.current);
    } finally {
      setExporting(null);
    }
  }

  async function exportImage() {
    try {
      await exportReport("image", async (element) => triggerDownload(await renderReportToPng(element), `${fileBase()}.png`));
    } catch (error) {
      setNotice({
        type: "error",
        message: `Không thể tạo ảnh báo cáo: ${error instanceof Error ? error.message : "lỗi không xác định"}`,
      });
    }
  }

  // A wide table on A4 would be too small to read. Counted on the report's columns, whichever view is open now.
  function pdfPaperFormat() {
    const reportColumns = rows.length - (hidden.report[market] ?? defaultHidden("report", rows)).length;
    return reportColumns > 10 ? "a3" : "a4";
  }

  async function exportPdf() {
    try {
      await exportReport("pdf", (element) => saveReportAsPdf(element, `${fileBase()}.pdf`, { format: pdfPaperFormat() }));
    } catch (error) {
      setNotice({
        type: "error",
        message: `Không thể xuất PDF: ${error instanceof Error ? error.message : "lỗi không xác định"}`,
      });
    }
  }

  async function sendToLark(format: LarkFormat) {
    try {
      await exportReport("lark", (element) =>
        sendReportToLark(element, `${fileBase()}.png`, { format, pdf: { format: pdfPaperFormat() } }),
      );
      setNotice({
        type: "success",
        message: larkSentMessage(format, "báo cáo lợi nhuận"),
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Không thể gửi báo cáo tới Lark.",
      });
    }
  }

  function updateFromPos() {
    if (!current || !rangeFrom || refreshing) return;
    void refresh(current.key, shopNumber, rangeFrom, rangeTo);
  }

  async function save() {
    if (!shop || !rangeFrom || !changes.length) return;
    setSaving(true);
    setNotice(null);
    try {
      await request("/api/costs/daily", {
        method: "POST",
        body: JSON.stringify({ shopId: shop.id, market, cells: changes }),
      });
      const { cells } = await request<{ cells: SheetCell[] }>(`/api/costs/daily?shopId=${shop.id}&from=${rangeFrom}&to=${rangeTo}`);
      setLoaded((previous) => (previous ? { ...previous, cells } : previous));
      setDrafts({});
      setNotice({
        type: "success",
        message: `Đã lưu ${changes.length} ô. Mọi báo cáo của shop đều dùng số này từ lần lấy dữ liệu tới.`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Không lưu được.",
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * A block pasted from a spreadsheet. One line (a line of the accountant's Excel: the days run across) fills the column
   * downwards, day after day. Several lines are days, and their values fill the typed columns shown, left to right.
   */
  function paste(event: ClipboardEvent<HTMLInputElement>, dayIndex: number, columnIndex: number) {
    const text = event.clipboardData.getData("text").replace(/\r/g, "").replace(/\n+$/, "");
    if (!/[\t\n]/.test(text)) return; // one value: the normal paste
    event.preventDefault();
    const lines = text.split("\n").map((line) => line.split("\t"));
    const grid = lines.length === 1 ? lines[0].map((value) => [value]) : lines;
    setDrafts((previous) => {
      const next = { ...previous };
      grid.forEach((values, down) => {
        const date = days[dayIndex + down];
        if (!date) return;
        values.forEach((value, across) => {
          const input = inputColumns[columnIndex + across]?.input;
          if (input) next[cellKey(date, input.channel, input.line)] = value.trim();
        });
      });
      return next;
    });
  }

  function move(event: KeyboardEvent<HTMLInputElement>, dayIndex: number, columnIndex: number) {
    const step = event.key === "Enter" || event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    document.getElementById(`pnl-cell-${dayIndex + step}-${columnIndex}`)?.focus();
  }

  const revenueTotal = computed.total.get("1") ?? 0;
  const alerts = warnings.filter((warning) => warning.startsWith("⚠"));
  const notes = warnings.filter((warning) => !warning.startsWith("⚠"));
  const format = (row: PnlRow, value: number) => (row.ratio ? `${value.toFixed(2)}%` : money.format(value));
  const stickyDate = { left: 0, width: DATE_WIDTH, minWidth: DATE_WIDTH };
  const showTable = Boolean(current && !current.error && (storedDays.length || !refreshing));

  return (
    <main className="mx-auto w-full max-w-[1760px] flex-1 space-y-4 px-4 py-8 sm:px-6">
      <PageHeader
        title="Bảng lợi nhuận theo ngày"
        description="Kết quả kinh doanh từng ngày của mỗi shop. Số tự động lấy từ Pancake POS, Ads Meta và lương (lưu sẵn, mở là có); chi phí còn thiếu nhập ở chế độ “Nhập chi phí”."
      >
        <ExportButtons exporting={exporting} onImage={() => void exportImage()} onPdf={() => void exportPdf()} />
        <SendToLarkButton reportName={reportName} disabled={exporting !== null || !showTable} onConfirm={sendToLark} />
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <label className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Shop</span>
          <select
            className={cn(CONTROL, "min-w-56")}
            value={shopId}
            disabled={!shops.length}
            onChange={(event) => {
              if (!confirmLeave()) return;
              setDrafts({});
              setShopId(event.target.value);
            }}
          >
            {shops.length ? null : <option value="">Đang tải…</option>}
            {shops.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.currency})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Tháng</span>
          <Input
            type="month"
            className="h-9 w-40"
            value={month}
            max={today.slice(0, 7)}
            onChange={(event) => {
              if (!confirmLeave()) return;
              setDrafts({});
              setMonth(event.target.value);
            }}
          />
        </label>
        <div className="space-y-1">
          <Button variant="outline" size="lg" className="h-9" disabled={!current || Boolean(refreshing)} onClick={updateFromPos}>
            {refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            Cập nhật dữ liệu POS
          </Button>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          {range
            ? `${toDmy(range.from)} – ${toDmy(range.to)}${range.to === today ? " (đến hôm nay)" : ""} · tiền ${market === "PHP" ? "peso ₱" : "đồng ₫"}`
            : today
              ? "Tháng này chưa bắt đầu."
              : ""}
          {refreshing ? (
            <span className="block font-medium text-foreground">
              Đang lấy {refreshing.from === refreshing.to ? `ngày ${toDmy(refreshing.from)}` : `${toDmy(refreshing.from)} – ${toDmy(refreshing.to)}`} từ POS…
            </span>
          ) : fetchedTimes.length ? (
            <span className="block">
              Số POS lấy lúc {timeLabel(fetchedTimes[0])}
              {fetchedTimes[0] !== fetchedTimes[fetchedTimes.length - 1] ? ` – ${timeLabel(fetchedTimes[fetchedTimes.length - 1])}` : ""}. Bấm cập nhật nếu đơn
              cũ đã đổi trạng thái hoặc vừa sửa lương / chi phí cố định.
            </span>
          ) : null}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{changes.length ? `${changes.length} ô chưa lưu` : ""}</span>
          <Button variant="ghost" size="lg" className="h-9" disabled={saving || !Object.keys(drafts).length} onClick={() => setDrafts({})}>
            <Undo2 />
            Bỏ thay đổi
          </Button>
          <Button size="lg" className="h-9" disabled={saving || loading || !changes.length || invalid > 0} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Lưu chi phí
          </Button>
        </div>
      </div>

      <Notice notice={notice} />
      {current?.error ? <Notice notice={{ type: "error", message: current.error }} /> : null}
      {current && !current.configured ? (
        <Notice
          notice={{
            type: "warning",
            message: "Chưa cấu hình MySQL: số liệu không được lưu, mỗi lần mở trang đều phải lấy lại từ POS.",
          }}
        />
      ) : null}
      {invalid ? (
        <Notice
          notice={{
            type: "error",
            message: `${invalid} ô không phải số (chỉ gõ chữ số, dấu chấm hoặc phẩy). Sửa trước khi lưu.`,
          }}
        />
      ) : null}
      {alerts.length ? (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {alerts.map((alert) => (
            <p key={alert}>{alert}</p>
          ))}
        </div>
      ) : null}

      {showTable ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-8 rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Chế độ xem">
              {(
                [
                  ["input", "Nhập chi phí", PencilLine],
                  ["report", "Báo cáo", FileText],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  onClick={() => setView(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                    view === value && "bg-background text-foreground shadow-xs",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                  {value === "input" && changes.length ? <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">{changes.length}</span> : null}
                </button>
              ))}
            </div>
            <details className="relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-medium hover:bg-muted [&::-webkit-details-marker]:hidden">
                <Columns3 className="size-3.5" aria-hidden="true" />
                Cột hiển thị ({columns.length}/{rows.length})
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </summary>
              <div className="absolute left-0 z-40 mt-1 w-80 rounded-lg border bg-background p-3 text-xs shadow-lg">
                <p className="mb-1.5 text-muted-foreground">
                  Chọn riêng cho chế độ “{view === "report" ? "Báo cáo" : "Nhập chi phí"}”; được nhớ trên trình duyệt này.
                </p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Button variant="outline" size="xs" onClick={() => setColumns([])}>
                    Tất cả
                  </Button>
                  {view === "report" ? (
                    <Button variant="outline" size="xs" onClick={() => setColumns(defaultHidden("report", rows))}>
                      Mặc định
                    </Button>
                  ) : null}
                  <Button variant="outline" size="xs" onClick={() => setColumns(rows.filter((row) => !isCompactColumn(row)).map((row) => row.id))}>
                    Gọn (tổng & lợi nhuận)
                  </Button>
                  {view === "input" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setColumns(rows.filter((row) => !row.input && !isCompactColumn(row)).map((row) => row.id))}
                    >
                      Gọn + cột nhập
                    </Button>
                  ) : null}
                </div>
                <ul className="max-h-80 space-y-0.5 overflow-auto">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted">
                        <input
                          type="checkbox"
                          className="size-3.5"
                          checked={!hiddenIds.has(row.id)}
                          onChange={(event) => setColumns(event.target.checked ? hiddenList.filter((id) => id !== row.id) : [...hiddenList, row.id])}
                        />
                        <span className={cn("w-9 shrink-0 text-right text-muted-foreground")}>{row.stt}</span>
                        <span className={cn(row.style === "detail" || row.style === "ratio" ? "pl-3 text-muted-foreground" : "")}>
                          {row.style === "detail" && row.input?.channel ? `${parentLabel(rows, row)} · ` : ""}
                          {row.label}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
            {(view === "input" ? coverage : []).map((item) => (
              <span
                key={item.id}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px]",
                  item.covered === sellingDays ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900",
                )}
              >
                {item.label}:{" "}
                <strong className="tabular-nums">
                  {item.covered}/{sellingDays}
                </strong>{" "}
                ngày có doanh số đã có số
              </span>
            ))}
          </div>

          {view === "report" ? (
            <ReportViewport>
              <PnlReport
                reportRef={reportRef}
                market={market}
                shopName={shop?.name ?? ""}
                from={rangeFrom}
                to={rangeTo}
                rows={rows}
                columns={columns}
                days={days}
                computed={computed}
                fetchedAt={fetchedTimes}
                missing={coverage
                  .filter((item) => item.covered < sellingDays)
                  .map(
                    (item) =>
                      `Chưa có ${item.label.toLowerCase()} của ${sellingDays - item.covered}/${sellingDays} ngày có doanh số: lợi nhuận các ngày này đang cao hơn thực tế.`,
                  )}
              />
            </ReportViewport>
          ) : (
            <div className="overflow-auto rounded-xl border bg-background" style={{ maxHeight: "calc(100vh - 15rem)" }}>
              <table className="border-separate border-spacing-0 text-xs tabular-nums">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th
                      className="sticky z-30 border-b border-r bg-muted px-2 py-2 text-left align-bottom font-medium text-muted-foreground"
                      style={stickyDate}
                    >
                      Ngày
                    </th>
                    {columns.map((row) => (
                      <th
                        key={row.id}
                        className={cn("min-w-28 max-w-36 border-b border-r px-2 py-1.5 text-right align-bottom leading-tight", COLUMN_STYLE[row.style])}
                      >
                        {row.source ? (
                          <span className={cn("mb-1 inline-block rounded border px-1 text-[9px] font-normal", SOURCE_STYLE[row.source])}>{row.source}</span>
                        ) : null}
                        <span className="block text-[10px] font-normal text-muted-foreground">{row.stt}</span>
                        {row.style === "detail" && row.input?.channel ? <span className="block text-[10px] font-normal">{parentLabel(rows, row)}</span> : null}
                        {row.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="sticky z-30 border-b border-r bg-muted px-2 py-1.5 text-left font-semibold text-destructive" style={stickyDate}>
                      Tổng ({unit})
                    </th>
                    {columns.map((row) => {
                      const total = computed.total.get(row.id) ?? 0;
                      return (
                        <th
                          key={row.id}
                          className={cn(
                            "border-b border-r bg-muted px-2 py-1.5 text-right font-semibold",
                            row.style === "result" && total < 0 && "text-destructive",
                          )}
                        >
                          {format(row, total)}
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    <th className="sticky z-30 border-b-2 border-r bg-muted px-2 py-1 text-left font-medium text-muted-foreground" style={stickyDate}>
                      Tỷ trọng
                    </th>
                    {columns.map((row) => (
                      <th key={row.id} className="border-b-2 border-r bg-muted px-2 py-1 text-right font-normal text-muted-foreground">
                        {row.ratio ? "" : revenueTotal ? `${(((computed.total.get(row.id) ?? 0) / revenueTotal) * 100).toFixed(2)}%` : "—"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((date, dayIndex) => {
                    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
                    const pending = !reportValues.has(date);
                    return (
                      <tr key={date} className={cn("hover:bg-muted/30", weekday === 0 && "bg-muted/20")}>
                        <th scope="row" className="sticky z-10 border-b border-r bg-background px-2 py-1 text-left font-medium" style={stickyDate}>
                          {toDmy(date).slice(0, 5)}{" "}
                          <span className={cn("text-[10px] font-normal", weekday === 0 ? "text-destructive" : "text-muted-foreground")}>
                            {WEEKDAYS[weekday]}
                          </span>
                          {pending ? <span className="block text-[9px] font-normal text-amber-700">chưa có số POS</span> : null}
                        </th>
                        {columns.map((row) => {
                          const value = computed.byDay.get(row.id)?.[dayIndex] ?? 0;
                          if (!row.input) {
                            return (
                              <td
                                key={row.id}
                                className={cn(
                                  "border-b border-r px-2 py-1 text-right",
                                  (row.style === "revenue" || row.style === "major" || row.style === "result") && "font-medium",
                                  row.style === "result" && value < 0 && "text-destructive",
                                  value === 0 && "text-muted-foreground/50",
                                )}
                              >
                                {format(row, value)}
                              </td>
                            );
                          }
                          const columnIndex = inputColumns.indexOf(row);
                          const { line, channel } = row.input;
                          const key = cellKey(date, channel, line);
                          const draft = drafts[key];
                          const storedAmount = stored.get(key);
                          const text = draft?.trim() ?? "";
                          const bad = text !== "" && !isAmountText(text);
                          const edited = text !== "" && (bad || storedAmount !== parseAmountText(text));
                          const usesFallback = draft === undefined && !(storedAmount && storedAmount > 0);
                          // Empty cell: the report's own figure (estimate / POS), or the stored amount a cleared cell keeps.
                          const hint = usesFallback
                            ? (fallback.byDay.get(row.id)?.[dayIndex] ?? 0)
                            : draft !== undefined && text === ""
                              ? (storedAmount ?? 0)
                              : 0;
                          return (
                            <td key={row.id} className="border-b border-r bg-amber-50/50 p-0.5">
                              <input
                                id={`pnl-cell-${dayIndex}-${columnIndex}`}
                                inputMode="decimal"
                                autoComplete="off"
                                aria-label={`${row.label}${channel ? ` (${channel === "zalo" ? "Zalo" : "Page"})` : ""} ngày ${toDmy(date)}`}
                                aria-invalid={bad || undefined}
                                disabled={saving}
                                value={draft ?? (storedAmount && storedAmount > 0 ? String(storedAmount) : "")}
                                placeholder={hint ? money.format(hint) : ""}
                                title={usesFallback && hint ? "Chưa nhập: báo cáo đang dùng số ước tính / POS này" : undefined}
                                onChange={(event) =>
                                  setDrafts((previous) => ({
                                    ...previous,
                                    [key]: event.target.value,
                                  }))
                                }
                                onPaste={(event) => paste(event, dayIndex, columnIndex)}
                                onKeyDown={(event) => move(event, dayIndex, columnIndex)}
                                className={cn(
                                  "h-7 w-full min-w-24 rounded border border-transparent bg-transparent px-1.5 text-right outline-none placeholder:text-muted-foreground/60 hover:border-amber-300 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/40",
                                  edited && "border-amber-500 bg-amber-100",
                                  bad && "border-destructive bg-destructive/10",
                                )}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : loading || refreshing ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {refreshing ? "Lần đầu mở tháng này: đang lấy số liệu từ Pancake POS và Ads Meta, lần sau sẽ mở ngay…" : "Đang đọc số liệu đã lưu…"}
        </div>
      ) : !current?.error ? (
        <p className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
          {range ? "Chọn shop để xem bảng." : "Chọn một tháng đã bắt đầu."}
        </p>
      ) : null}

      <details className="group rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between font-medium [&::-webkit-details-marker]:hidden">
          Cách dùng và nguồn số liệu
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
          <li>
            Nhãn trên mỗi cột cho biết nguồn: <strong>POS</strong> (Pancake), <strong>Meta</strong> (Ads Meta của tài khoản gắn nhãn shop),{" "}
            <strong>Lương</strong> (lương nhân sự ÷ công chuẩn, chỉ ngày có đơn; sửa ở{" "}
            <Link href="/fixed-costs" className="underline">
              trang Chi phí
            </Link>
            ), <strong>Nhập</strong> (cột nền vàng, gõ được).
          </li>
          <li>
            Số tự động được lưu theo ngày. Mở trang chỉ lấy từ POS những ngày chưa có, hoặc ngày lấy khi chưa hết ngày (hôm nay: tối đa 30 phút một lần). Đơn cũ
            đổi trạng thái (hoàn, huỷ) hoặc vừa sửa lương / chi phí cố định / tỷ giá thì bấm <strong>Cập nhật dữ liệu POS</strong> để lấy lại cả tháng.
            {market === "PHP"
              ? " Số của shop Phil còn phụ thuộc tỷ lệ hoàn lũy kế tháng (đổi mỗi ngày, cả tháng dùng chung một tỷ lệ) nên các ngày của tháng đang chạy tự được lấy lại mỗi ngày một lần, và ngày của tháng đã qua chỉ được chốt khi đã lấy sau khi tháng kết thúc."
              : ""}
          </li>
          <li>Ô nhập để trống thì báo cáo dùng số ước tính hằng tháng hoặc số POS, hiện mờ trong ô. Gõ số để thay; gõ 0 nghĩa là ngày đó bằng 0.</li>
          <li>
            Enter hoặc ↓ xuống ngày kế tiếp, Tab sang cột kế tiếp. Copy một dòng chỉ tiêu trong Excel (các ngày nằm ngang) rồi dán vào ô của ngày đầu tiên: số
            tự điền xuống theo ngày. Copy nhiều dòng thì mỗi dòng là một ngày, các số điền vào các cột nhập đang hiện, từ trái sang phải.
          </li>
          <li>Nút “Cột hiển thị” để ẩn bớt cột; lựa chọn được nhớ trên trình duyệt này. Ẩn cột không làm đổi cách tính.</li>
          <li>
            Doanh số là doanh số thực tế (đơn đã chốt trừ hoàn), giống các báo cáo quản trị.{" "}
            {market === "VND"
              ? "Chi phí nhập theo từng kênh Zalo / Page; cột tổng tự cộng."
              : "Với shop Phil doanh số là tổng tiền của đơn (gồm phần khách trả trước), trừ đơn hoàn đã về và trừ thêm phần hoàn dự kiến: nhân (1 − tỷ lệ hoàn lũy kế tháng, cùng tỷ lệ với thẻ “Lũy kế tháng” ở báo cáo). Giá vốn cũng nhân (1 − tỷ lệ hoàn): tự tính theo giá vốn trung bình theo danh mục, hoặc theo giá vốn sản phẩm trong POS với shop dùng giá POS (GIP 273); giá vốn nhập tay thì giữ nguyên. Dự phòng rủi ro hàng tồn = giá vốn trước khi nhân × tỷ lệ hoàn × 50%. Phí giao hàng, dịch vụ mua ngoài, chi phí khác và thuế/phí tự tính theo số sản phẩm bán ra; ô nhập tay thay cho số tự tính."}
          </li>
          <li>Số đã lưu dùng chung với tab “Chi phí theo ngày” và mọi báo cáo của shop.</li>
        </ul>
        {notes.length ? (
          <div className="mt-2 border-t pt-2 text-muted-foreground">
            <p className="font-medium text-foreground">Ghi chú lần lấy dữ liệu gần nhất</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>
    </main>
  );
}
