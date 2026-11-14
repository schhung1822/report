"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { ArrowRightLeft, CloudDownload, FileDown, FileJson, FileSpreadsheet, History, LoaderCircle, Megaphone, Users, Wallet } from "lucide-react";
import { useAdsLabels } from "@/components/ads/ads-labels";
import { StaffCostTable, staffSourceOfResult } from "@/components/costs/staff-cost-table";
import { HistoryDialog } from "@/components/history/history-dialog";
import { MARKET_LABEL } from "@/lib/ads/label-types";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { ConfigSection } from "@/components/report-workspace";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCreatedAt } from "@/lib/history/summary";
import { COST_TEMPLATE_CSV, parseCostFile } from "@/lib/pancake/costs-file";
import { runWithConcurrency } from "@/lib/pancake/batch";
import { UNASSIGNED_STAFF } from "@/lib/pancake/dataset";
import { MAX_RANGE_DAYS, type ManualCostRow, type PancakeShop, type PancakeSyncResult } from "@/lib/pancake/types";
import { dayCount, localDate, RANGE_PRESETS } from "@/lib/range-presets";
import { safeFilePart, triggerDownload } from "@/lib/report-export";

type PancakeSyncCardProps = {
  /** Called with the full result; the page keeps the parts it needs. */
  onSynced: (result: PancakeSyncResult) => void;
  /** Only offer shops in these currencies (e.g. ["VND"] for pages that format money in dong). */
  currencies?: string[];
  /** Short description of what this page takes from Pancake. */
  hint?: string;
  /** Offer "Tất cả shop": fetch every shop in one go (several reports at once). */
  allowAllShops?: boolean;
};

/** Shops the reports can be built for, and how many are fetched at the same time in "all shops" mode. */
const SUPPORTED_CURRENCIES = ["VND", "PHP"];
const ALL_SHOPS = "all";
const BATCH_CONCURRENCY = 3;

/** An ISO instant in the browser's time zone ("05/11 11:00"). */
const localTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

export function PancakeSyncCard({ onSynced, currencies, hint, allowAllShops = false }: PancakeSyncCardProps) {
  const [shops, setShops] = useState<PancakeShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [costs, setCosts] = useState<ManualCostRow[]>([]);
  const [costFileName, setCostFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [keyProblems, setKeyProblems] = useState<string[]>([]);
  // Reports currently on screen: one per shop ("all shops" fetches several).
  const [results, setResults] = useState<PancakeSyncResult[]>([]);
  const [staffOpen, setStaffOpen] = useState(false);
  // Ad spend comes from the Meta accounts labelled for each shop (labels are kept on the Quảng cáo Meta page)
  const adsLabels = useAdsLabels();
  const [useMetaAds, setUseMetaAds] = useState(true);
  const labelCount = (market: "VN" | "PH") => adsLabels.labels.filter((label) => label.market === market).length;
  const [historyOpen, setHistoryOpen] = useState(false);
  // Reports on screen that were fetched before costs of their shop and days were saved: they show the old figures.
  const [outdated, setOutdated] = useState<{ shopId: number; name: string; from: string; to: string; changedAt: string; fetchedAt: string }[]>([]);
  // The page's handler changes on every render; the restore below runs once, so it reads the latest one from a ref.
  const onSyncedRef = useRef(onSynced);
  // Set once the user has fetched or opened a report, so a slow restore never overwrites it.
  const touchedRef = useRef(false);

  useEffect(() => {
    onSyncedRef.current = onSynced;
  });

  const currencyKey = currencies?.join(",") ?? "";
  const days = dayCount(from, to);
  const rangeValid = days >= 1 && days <= MAX_RANGE_DAYS;
  const last = results.at(-1) ?? null;
  /** The Vietnam result: the only one that has staff to enter costs for. */
  const staffResult = results.find((result) => result.performance) ?? null;
  const warningLines = results.flatMap((result) =>
    result.warnings.map((warning) => ({ text: results.length > 1 ? `[${result.shop.name}] ${warning}` : warning, alarm: warning.startsWith("⚠") })),
  );
  const hasAlarm = warningLines.some((line) => line.alarm);
  const staffCount = staffResult ? staffResult.dataset.staff.filter((entry) => entry.name !== UNASSIGNED_STAFF).length : 0;
  const batchable = allowAllShops && shops.length > 1;

  /** Shows stored reports' range and shop in the form, with a notice that they are not live data. */
  const showStored = useCallback((stored: PancakeSyncResult[], list: PancakeShop[], batch: boolean) => {
    const newest = stored.reduce((best, item) => ((item.snapshot?.createdAt ?? "") > (best.snapshot?.createdAt ?? "") ? item : best));
    setResults(stored);
    setFrom(newest.range.from);
    setTo(newest.range.to);
    if (batch && stored.length > 1) setShopId(ALL_SHOPS);
    else if (list.some((shop) => shop.id === newest.shop.id)) setShopId(String(newest.shop.id));
    setNotice({
      type: "warning",
      message:
        stored.length > 1
          ? `Đang xem ${stored.length} báo cáo đã lưu (mới nhất lúc ${formatCreatedAt(newest.snapshot?.createdAt ?? "")}). Bấm “Lấy dữ liệu” để cập nhật số mới nhất.`
          : `Đang xem báo cáo đã lưu lúc ${formatCreatedAt(newest.snapshot?.createdAt ?? "")} (${newest.shop.name} · ${newest.reportDate}). Bấm “Lấy dữ liệu” để cập nhật số mới nhất.`,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const allowed = currencyKey ? currencyKey.split(",") : null;
    const applyDefaultRange = () => {
      const yesterday = localDate(-1);
      setFrom((current) => current || yesterday);
      setTo((current) => current || yesterday);
    };

    /** Brings back the newest stored report of every shop, so a reload or tab change loses nothing. */
    async function restoreLatest(list: PancakeShop[]) {
      const queries = list.length
        ? list.map((shop) => `shopId=${shop.id}`)
        : (allowed ?? SUPPORTED_CURRENCIES).map((currency) => `currency=${currency}`);
      const restored: PancakeSyncResult[] = [];
      for (const query of queries) {
        try {
          const { snapshot } = await getJson<{ configured: boolean; snapshot: PancakeSyncResult | null }>(`/api/history/latest?${query}`);
          if (snapshot) restored.push(snapshot);
        } catch {
          // History is a convenience: never block the page because it cannot be read.
        }
      }
      if (cancelled || touchedRef.current || !restored.length) return;
      // Oldest first, so that for each currency the newest report is the one the page ends up showing.
      restored.sort((a, b) => (a.snapshot?.createdAt ?? "").localeCompare(b.snapshot?.createdAt ?? ""));
      for (const result of restored) onSyncedRef.current(result);
      showStored(restored, list, allowAllShops);
    }

    postJson<{ shops: PancakeShop[]; problems?: string[]; defaultShopId: number | null }>("/api/pancake/shops")
      .then(async ({ shops: all, problems, defaultShopId }) => {
        if (cancelled) return;
        const list = allowed ? all.filter((shop) => allowed.includes(shop.currency.toUpperCase())) : all;
        setShops(list);
        setShopId(
          allowAllShops && list.length > 1 ? ALL_SHOPS : String((list.find((shop) => shop.id === defaultShopId) ?? list[0])?.id ?? ""),
        );
        setKeyProblems(problems ?? []);
        applyDefaultRange();
        if (!list.length && all.length) {
          setNotice({
            type: "warning",
            message: `Tài khoản Pancake chưa có shop nào dùng ${allowed?.join("/")}. Hãy cấp quyền shop đó cho API key.`,
          });
        }
        await restoreLatest(list);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        applyDefaultRange();
        setNotice({ type: "warning", message: error instanceof Error ? error.message : "Không tải được danh sách shop." });
        // The shop list can fail (e.g. a broken API key) while stored reports are still readable.
        void restoreLatest([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currencyKey, showStored, allowAllShops]);

  // Costs are typed on other pages (Bảng lợi nhuận, Chi phí cố định) and only reach a report when it is fetched again, so a report
  // on screen (a stored one in particular) is compared with when its costs were last saved.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      results.map(async (result) => {
        try {
          const { changedAt } = await getJson<{ changedAt: string | null }>(`/api/costs/changes?shopId=${result.shop.id}&from=${result.range.from}&to=${result.range.to}`);
          if (!changedAt || Date.parse(changedAt) <= Date.parse(result.fetchedAt)) return null;
          return { shopId: result.shop.id, name: result.shop.name, from: result.range.from, to: result.range.to, changedAt, fetchedAt: result.fetchedAt };
        } catch {
          return null; // A convenience: never block the page because it cannot be read.
        }
      }),
    ).then((found) => {
      if (!cancelled) setOutdated(found.filter((item): item is NonNullable<typeof item> => item !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [results]);

  function openFromHistory(result: PancakeSyncResult) {
    touchedRef.current = true;
    onSynced(result);
    showStored([result], shops, false);
  }

  function changeFrom(value: string) {
    setFrom(value);
    if (value && (!to || value > to)) setTo(value);
  }

  function changeTo(value: string) {
    setTo(value);
    if (value && (!from || value < from)) setFrom(value);
  }

  async function handleCostFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const rows = await parseCostFile(file);
      setCosts(rows);
      setCostFileName(file.name);
      setNotice({ type: "success", message: `Đã nạp ${rows.length} dòng chi phí từ “${file.name}”. Bấm “Lấy dữ liệu” để áp dụng.` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không đọc được file chi phí." });
    }
  }

  function downloadCostTemplate() {
    const url = URL.createObjectURL(new Blob(["﻿", COST_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
    triggerDownload(url, "mau-chi-phi-ngoai-pos.csv");
    URL.revokeObjectURL(url);
  }

  function downloadDataset() {
    if (!last) return;
    const single = results.length === 1;
    const content = single ? last.dataset : { schemaVersion: 1, shops: results.map((result) => result.dataset) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
    triggerDownload(url, single ? `pancake-${safeFilePart(last.shop.name)}-${last.range.from}_${last.range.to}.json` : `pancake-tat-ca-shop-${last.range.from}_${last.range.to}.json`);
    URL.revokeObjectURL(url);
  }

  /** Fetches the selected shop, or every supported shop in "all shops" mode. `onlyShopId` re-fetches just that one. */
  async function sync(onlyShopId?: number, range = { from, to }) {
    touchedRef.current = true;
    const batch = onlyShopId === undefined && shopId === ALL_SHOPS;
    const targets: { id: number; name: string }[] = onlyShopId !== undefined
      ? [{ id: onlyShopId, name: results.find((result) => result.shop.id === onlyShopId)?.shop.name ?? String(onlyShopId) }]
      : batch
        ? shops.filter((shop) => SUPPORTED_CURRENCIES.includes(shop.currency.toUpperCase()))
        : [{ id: Number(shopId), name: shops.find((shop) => String(shop.id) === shopId)?.name ?? shopId }];

    setLoading(true);
    setNotice({ type: "warning", message: batch ? `Đang lấy ${targets.length} shop từ Pancake POS...` : "Đang lấy và đối soát số liệu từ Pancake POS..." });
    try {
      const outcome = await runWithConcurrency(
        targets,
        BATCH_CONCURRENCY,
        async (target) => {
          const result = await postJson<PancakeSyncResult>("/api/pancake/sync", { from: range.from, to: range.to, shopId: target.id, costs, useMetaAds });
          onSynced(result);
          return result;
        },
        (settled, total) => {
          if (batch) setNotice({ type: "warning", message: `Đang lấy shop... đã xong ${settled}/${total}` });
        },
      );
      const fetched = outcome.succeeded.map((item) => item.value);
      const failures = outcome.failed.map((item) => `${targets[item.index].name}: ${item.error instanceof Error ? item.error.message : "không đồng bộ được"}`);
      if (!fetched.length) throw new Error(failures.join(" | ") || "Không thể đồng bộ từ Pancake POS.");

      // A single-shop refresh (after saving staff costs) replaces just that shop's report and keeps the others.
      setResults((current) =>
        onlyShopId === undefined ? fetched : current.some((item) => item.shop.id === onlyShopId) ? current.map((item) => (item.shop.id === onlyShopId ? fetched[0] : item)) : fetched,
      );

      const mismatched = fetched.reduce((total, result) => total + result.dataset.checks.filter((check) => !check.ok).length, 0);
      const checks = fetched.reduce((total, result) => total + result.dataset.checks.length, 0);
      const saved = fetched.every((result) => result.snapshot);
      setNotice({
        type: mismatched || failures.length ? "warning" : "success",
        message:
          (fetched.length > 1 || batch
            ? `Đã lấy ${fetched.length}/${targets.length} shop (${fetched[0].range.dayCount} ngày)`
            : `Đã lấy ${fetched[0].range.dayCount} ngày (${fetched[0].shop.currency})`) +
          (mismatched ? `, đối soát lệch ${mismatched}/${checks} mục, xem cảnh báo` : `, đối soát ${checks}/${checks} mục khớp`) +
          (saved ? " · đã lưu vào lịch sử" : "") +
          (failures.length ? `. Lỗi: ${failures.join(" | ")}` : "."),
      });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể đồng bộ từ Pancake POS." });
    } finally {
      setLoading(false);
    }
  }

  const control =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

  return (
    <>
      <ConfigSection title="Dữ liệu Pancake POS">
        <div className="space-y-1">
          <Label htmlFor="pancake-shop" className="text-[11px] text-muted-foreground">
            Shop
          </Label>
          <select id="pancake-shop" value={shopId} onChange={(event) => setShopId(event.target.value)} disabled={loading || shops.length === 0} className={control}>
            {shops.length === 0 ? <option value="">Chưa có shop</option> : null}
            {batchable ? <option value={ALL_SHOPS}>Tất cả shop ({shops.length})</option> : null}
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name} ({shop.currency})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="pancake-from" className="text-[11px] text-muted-foreground">
              Từ ngày
            </Label>
            <Input id="pancake-from" type="date" value={from} onChange={(event) => changeFrom(event.target.value)} disabled={loading} className="h-8 px-2 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pancake-to" className="text-[11px] text-muted-foreground">
              Đến ngày
            </Label>
            <Input id="pancake-to" type="date" value={to} onChange={(event) => changeTo(event.target.value)} disabled={loading} className="h-8 px-2 text-xs" />
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="outline"
              size="xs"
              disabled={loading}
              onClick={() => {
                const range = preset.range();
                setFrom(range.from);
                setTo(range.to);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <Button size="lg" className="h-9 w-full" onClick={() => void sync()} disabled={loading || !rangeValid || !shopId}>
          {loading ? <LoaderCircle className="animate-spin" /> : <CloudDownload />}
          Lấy dữ liệu
        </Button>
        <p className={`text-[11px] ${rangeValid || !from ? "text-muted-foreground" : "text-destructive"}`}>
          {rangeValid
            ? `${days} ngày${costs.length ? ` · ${costs.length} dòng chi phí từ file` : ""}${useMetaAds && adsLabels.labels.length ? ` · Ads Meta ${adsLabels.labels.length} tài khoản` : ""}`
            : `Khoảng ngày phải từ 1 đến ${MAX_RANGE_DAYS} ngày.`}
        </p>

        <Button variant="outline" size="sm" className="w-full" onClick={() => setHistoryOpen(true)}>
          <History />
          Lịch sử báo cáo
        </Button>

        {keyProblems.length ? (
          <Notice notice={{ type: "warning", message: `API key không dùng được (các shop còn lại vẫn hoạt động): ${keyProblems.join(" | ")}` }} />
        ) : null}
        <Notice notice={notice} />

        {outdated.length ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {outdated.map((item) => (
              <p key={item.shopId}>
                Chi phí của {item.name} vừa được cập nhật lúc {localTime(item.changedAt)}, sau lần lấy báo cáo này (lúc {localTime(item.fetchedAt)}), nên báo cáo đang hiện số cũ.
              </p>
            ))}
            <Button
              size="sm"
              className="w-full"
              disabled={loading}
              onClick={() =>
                void (async () => {
                  for (const item of outdated) await sync(item.shopId, { from: item.from, to: item.to });
                })()
              }
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <CloudDownload />}
              Áp dụng chi phí mới
            </Button>
          </div>
        ) : null}

        {warningLines.length ? (
          <details open={hasAlarm} className="rounded-lg border bg-muted/30 px-2.5 py-1.5">
            <summary className={`cursor-pointer text-xs font-medium ${hasAlarm ? "text-destructive" : "text-muted-foreground"}`}>
              {hasAlarm ? "⚠ " : ""}Cảnh báo & ghi chú ({warningLines.length})
            </summary>
            <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-4 text-[11px] leading-4 text-muted-foreground">
              {warningLines.map((line) => (
                <li key={line.text} className={line.alarm ? "font-medium text-destructive" : undefined}>
                  {line.text}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {staffResult ? (
          <Button variant="outline" size="sm" className="w-full justify-between" onClick={() => setStaffOpen(true)}>
            <span className="flex items-center gap-1.5">
              <Users />
              Chi phí nhân sự
            </span>
            <span className="text-muted-foreground">{staffCount} người</span>
          </Button>
        ) : null}
      </ConfigSection>

      <ConfigSection title="Chi phí & tuỳ chọn" collapsible defaultOpen={false}>
        <div className="grid grid-cols-2 gap-1.5">
          <Link href="/fixed-costs" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs hover:bg-muted">
            <Wallet className="size-3.5" aria-hidden="true" />
            Chi phí cố định
          </Link>
          <Link href="/exchange-rates" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs hover:bg-muted">
            <ArrowRightLeft className="size-3.5" aria-hidden="true" />
            Tỷ giá
          </Link>
        </div>

        <div className="space-y-1">
          <Label htmlFor="pancake-costs" className="text-[11px] text-muted-foreground">
            Chi phí thêm từ file (tuỳ chọn)
          </Label>
          <div className="flex items-center gap-1.5">
            <label htmlFor="pancake-costs" className="inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-2 text-xs hover:bg-muted">
              <FileSpreadsheet className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{costFileName ? `${costFileName} (${costs.length})` : "Chọn file chi phí"}</span>
            </label>
            <input id="pancake-costs" type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={loading} onChange={(event) => void handleCostFile(event)} />
            <Button variant="outline" size="sm" onClick={downloadCostTemplate} title="Tải file mẫu">
              <FileDown />
              Mẫu
            </Button>
          </div>
        </div>

        <div className="space-y-1 rounded-lg border px-2.5 py-2">
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5 size-3.5" checked={useMetaAds} disabled={loading} onChange={(event) => setUseMetaAds(event.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Megaphone className="size-3.5" aria-hidden="true" />
                Chi phí quảng cáo từ Meta
              </span>
              <span className="block text-[10px] leading-4 text-muted-foreground">
                {adsLabels.labels.length
                  ? `Tự lấy từ tài khoản gắn nhãn: ${MARKET_LABEL.VN} ${labelCount("VN")} · ${MARKET_LABEL.PH} ${labelCount("PH")}. Ngày/kênh đã nhập ads tay thì giữ số nhập tay.`
                  : "Chưa có tài khoản nào gắn nhãn shop Việt/Phil."}
              </span>
            </span>
          </label>
          <Link href="/ads" className="block text-[11px] text-primary underline-offset-2 hover:underline">
            Gắn nhãn tài khoản quảng cáo
          </Link>
        </div>

        <Button variant="outline" size="sm" className="w-full" onClick={downloadDataset} disabled={!last}>
          <FileJson />
          Tải JSON chuẩn hoá
        </Button>

        {hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
      </ConfigSection>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        currencies={currencies}
        currentIds={results.flatMap((result) => (result.snapshot ? [result.snapshot.id] : []))}
        onOpenReport={openFromHistory}
      />

      <Dialog open={staffOpen} onOpenChange={setStaffOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Chi phí theo nhân sự</DialogTitle>
            <DialogDescription>{staffResult ? `${staffResult.shop.name} · ${staffResult.reportDate}` : ""}</DialogDescription>
          </DialogHeader>
          {staffResult ? <StaffCostTable source={staffSourceOfResult(staffResult)} embedded onSaved={() => void sync(staffResult.shop.id)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
