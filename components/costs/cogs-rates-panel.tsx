"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, Save, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/costs/money-input";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toDmy } from "@/lib/pancake/dates";
import { COGS_CATEGORIES, cogsRatesOn, type CogsRates, type CogsRatesEntry } from "@/lib/pancake/ph-cogs";
import type { PancakeShop } from "@/lib/pancake/types";
import { localDate } from "@/lib/range-presets";

type Form = Record<keyof CogsRates, string>;
type Loaded = { shopId: number; rates: CogsRatesEntry[]; today: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

const EMPTY: Form = { shoes: "", sets: "", clothes: "" };
const toForm = (rates: CogsRates | null): Form => (rates ? { shoes: String(rates.shoes), sets: String(rates.sets), clothes: String(rates.clothes) } : EMPTY);
const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

/**
 * Philippines shop: the average cost of goods (pesos per item) of each kind of goods. Every report multiplies the items sold of a
 * kind on a day by it to get the day's cost of goods, so the cost of goods is not typed per day. A set counts from its effective
 * date on; the days before keep the old amount. Until one is saved the reports do not work a cost of goods out.
 */
export function CogsRatesPanel({ shop, configured }: { shop: PancakeShop | undefined; configured: boolean | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const shopId = shop?.id ?? 0;
  const current = loaded?.shopId === shopId ? loaded : null;
  const loading = Boolean(shopId) && configured !== false && !current;
  const inForce = current ? cogsRatesOn(current.rates, current.today) : null;
  const sorted = useMemo(() => [...(current?.rates ?? [])].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)), [current]);

  useEffect(() => {
    if (!shopId || configured === false) return;
    let cancelled = false;
    request<{ rates: CogsRatesEntry[] }>(`/api/costs/cogs-rates?shopId=${shopId}`)
      .then(({ rates }) => {
        if (cancelled) return;
        const today = localDate();
        setLoaded({ shopId, rates, today });
        setForm(toForm(cogsRatesOn(rates, today)));
        setEffectiveDate((date) => date || `${today.slice(0, 7)}-01`);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ type: "error", message: error instanceof Error ? error.message : "Không tải được giá vốn." });
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, configured, reloadToken]);

  const valid = COGS_CATEGORIES.every(({ key }) => form[key] !== "" && Number.isFinite(Number(form[key]))) && Boolean(effectiveDate);

  async function save() {
    if (!shop || !valid) return;
    setSaving(true);
    setNotice(null);
    try {
      await request("/api/costs/cogs-rates", {
        method: "POST",
        body: JSON.stringify({ shopId: shop.id, effectiveDate, ...Object.fromEntries(COGS_CATEGORIES.map(({ key }) => [key, Number(form[key])])) }),
      });
      setLoaded(null);
      setReloadToken((token) => token + 1);
      setNotice({
        type: "success",
        message: `Đã lưu giá vốn có hiệu lực từ ${toDmy(effectiveDate)}. Báo cáo đã lấy trước đó chưa đổi: hãy lấy lại dữ liệu (trong Bảng lợi nhuận: “Cập nhật dữ liệu POS”).`,
      });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu giá vốn." });
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: CogsRatesEntry) {
    if (!shop || !window.confirm(`Xóa bộ giá vốn có hiệu lực từ ${toDmy(entry.effectiveDate)}? Các ngày đó sẽ dùng bộ giá vốn trước đó (nếu không có thì không tự tính giá vốn).`)) return;
    setNotice(null);
    try {
      await request(`/api/costs/cogs-rates?shopId=${shop.id}&effectiveDate=${entry.effectiveDate}`, { method: "DELETE" });
      setLoaded(null);
      setReloadToken((token) => token + 1);
      setNotice({ type: "success", message: "Đã xóa bộ giá vốn. Hãy lấy lại dữ liệu báo cáo để áp dụng." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể xóa giá vốn." });
    }
  }

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-xs text-muted-foreground">
        Giá vốn trong ngày của shop Phil = số sản phẩm bán ra của từng danh mục × giá vốn trung bình ở đây. Đơn có thẻ “Quần Áo” trên POS là <b>đồ bộ</b> nếu ghi chú đơn có chữ “set”, không
        có thì là <b>quần áo lẻ</b>; mọi đơn khác là <b>giày dép</b>. Số sản phẩm của một đơn là số lượng trong đơn; đơn huỷ không tính, đơn hoàn được trừ ở giá vốn thực tế. Ngày nào kế toán đã nhập giá vốn
        riêng ở tab “Chi phí theo ngày” thì dùng số đó. Đơn lẫn cả giày và quần áo chưa tách được: báo cáo sẽ ghi số đơn như vậy.
      </p>
      <Notice notice={notice} />

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          {COGS_CATEGORIES.map(({ key, label }) => (
            <div key={key} className="w-44 space-y-1">
              <Label htmlFor={`cogs-${key}`} className="text-[11px] text-muted-foreground">
                {label} (₱/sản phẩm)
              </Label>
              <MoneyInput
                id={`cogs-${key}`}
                className="h-8 text-right text-xs tabular-nums"
                value={form[key]}
                placeholder="0"
                disabled={loading || configured === false}
                onValueChange={(raw) => setForm((value) => ({ ...value, [key]: raw }))}
              />
            </div>
          ))}
          <div className="w-40 space-y-1">
            <Label htmlFor="cogs-effective" className="text-[11px] text-muted-foreground">
              Có hiệu lực từ ngày
            </Label>
            <Input
              id="cogs-effective"
              type="date"
              className="h-8 text-xs"
              value={effectiveDate}
              disabled={loading || configured === false}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </div>
          <Button size="sm" disabled={!valid || saving || loading || configured === false} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Lưu giá vốn
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {current
            ? inForce
              ? `Đang áp dụng hôm nay: ${COGS_CATEGORIES.map(({ key, label }) => `${label} ${money.format(inForce[key])}`).join(" · ")}.`
              : "Chưa có bộ giá vốn nào có hiệu lực: báo cáo chưa tự tính giá vốn (giá vốn POS Phil bằng 0 nên lợi nhuận đang cao hơn thực tế)."
            : "…"}{" "}
          Muốn đổi giá vốn từ một ngày về sau, nhập số mới và chọn ngày đó: các ngày trước giữ mức cũ.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table className="text-xs">
          <TableHeader className="bg-muted/50 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead>Hiệu lực từ</TableHead>
              {COGS_CATEGORIES.map(({ key, label }) => (
                <TableHead key={key} className="text-right">
                  {label}
                </TableHead>
              ))}
              <TableHead>Lưu bởi</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:px-3 [&_td]:py-2">
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  <LoaderCircle className="mr-1.5 inline size-3.5 animate-spin" />
                  Đang tải…
                </TableCell>
              </TableRow>
            ) : sorted.length ? (
              sorted.map((entry) => (
                <TableRow key={entry.effectiveDate}>
                  <TableCell className="whitespace-nowrap font-medium">{toDmy(entry.effectiveDate)}</TableCell>
                  {COGS_CATEGORIES.map(({ key }) => (
                    <TableCell key={key} className="text-right tabular-nums">
                      {money.format(entry[key])}
                    </TableCell>
                  ))}
                  <TableCell className="text-muted-foreground">{entry.updatedBy ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Sửa"
                      onClick={() => {
                        setForm(toForm(entry));
                        setEffectiveDate(entry.effectiveDate);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Xóa" onClick={() => void remove(entry)}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Chưa lưu bộ giá vốn nào. Nhập giá vốn trung bình của giày dép, đồ bộ và quần áo lẻ ở trên rồi bấm Lưu giá vốn.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
