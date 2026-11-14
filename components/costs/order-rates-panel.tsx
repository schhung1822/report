"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, RotateCcw, Save, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/costs/money-input";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toDmy } from "@/lib/pancake/dates";
import {
  DEFAULT_PER_ORDER_RATES,
  PER_ORDER_FIELDS,
  perOrderRatesOn,
  shippingPerOrder,
  type PerOrderRates,
  type PerOrderRatesEntry,
} from "@/lib/pancake/ph-order-costs";
import type { PancakeShop } from "@/lib/pancake/types";
import { localDate } from "@/lib/range-presets";

type Form = Record<keyof PerOrderRates, string>;
type Loaded = { shopId: number; rates: PerOrderRatesEntry[]; today: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

const toForm = (rates: PerOrderRates): Form => ({
  outsourced: String(rates.outsourced),
  shippingPedPh: String(rates.shippingPedPh),
  shippingPh: String(rates.shippingPh),
  other: String(rates.other),
  tax: String(rates.tax),
});

const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

/**
 * Philippines shop: the pesos per product (item sold) that outsourced services, shipping, other cost and tax/fee cost. They are multiplied by
 * the products sold each day in every report, so nothing is typed per day. A set counts from its effective date on; the days before
 * keep the old amount. Until one is saved the defaults apply.
 */
export function OrderRatesPanel({ shop, configured }: { shop: PancakeShop | undefined; configured: boolean | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Form>(toForm(DEFAULT_PER_ORDER_RATES));
  const [effectiveDate, setEffectiveDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const shopId = shop?.id ?? 0;
  const current = loaded?.shopId === shopId ? loaded : null;
  const loading = Boolean(shopId) && configured !== false && !current;
  const inForce = current ? perOrderRatesOn(current.rates, current.today) : DEFAULT_PER_ORDER_RATES;
  const sorted = useMemo(() => [...(current?.rates ?? [])].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)), [current]);

  useEffect(() => {
    if (!shopId || configured === false) return;
    let cancelled = false;
    request<{ rates: PerOrderRatesEntry[] }>(`/api/costs/order-rates?shopId=${shopId}`)
      .then(({ rates }) => {
        if (cancelled) return;
        const today = localDate();
        setLoaded({ shopId, rates, today });
        setForm(toForm(perOrderRatesOn(rates, today)));
        setEffectiveDate((date) => date || `${today.slice(0, 7)}-01`);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ type: "error", message: error instanceof Error ? error.message : "Không tải được đơn giá." });
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, configured, reloadToken]);

  const filled = PER_ORDER_FIELDS.every(({ key }) => form[key] !== "" && Number.isFinite(Number(form[key])));
  const valid = filled && Boolean(effectiveDate);

  async function save() {
    if (!shop || !valid) return;
    setSaving(true);
    setNotice(null);
    try {
      await request("/api/costs/order-rates", {
        method: "POST",
        body: JSON.stringify({ shopId: shop.id, effectiveDate, ...Object.fromEntries(PER_ORDER_FIELDS.map(({ key }) => [key, Number(form[key])])) }),
      });
      setLoaded(null);
      setReloadToken((token) => token + 1);
      setNotice({
        type: "success",
        message: `Đã lưu đơn giá có hiệu lực từ ${toDmy(effectiveDate)}. Báo cáo đã lấy trước đó chưa đổi: hãy lấy lại dữ liệu (trong Bảng lợi nhuận: “Cập nhật dữ liệu POS”).`,
      });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu đơn giá." });
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: PerOrderRatesEntry) {
    if (!shop || !window.confirm(`Xóa bộ đơn giá có hiệu lực từ ${toDmy(entry.effectiveDate)}? Các ngày đó sẽ dùng bộ đơn giá trước đó (hoặc mức mặc định).`)) return;
    setNotice(null);
    try {
      await request(`/api/costs/order-rates?shopId=${shop.id}&effectiveDate=${entry.effectiveDate}`, { method: "DELETE" });
      setLoaded(null);
      setReloadToken((token) => token + 1);
      setNotice({ type: "success", message: "Đã xóa bộ đơn giá. Hãy lấy lại dữ liệu báo cáo để áp dụng." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể xóa đơn giá." });
    }
  }

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-xs text-muted-foreground">
        Chi phí dịch vụ mua ngoài, giao hàng, chi phí khác và thuế/phí của shop Phil = số sản phẩm bán ra trong ngày × đơn giá (peso mỗi sản phẩm) ở đây, nên không cần nhập từng ngày. Đơn giá có hiệu
        lực từ ngày chọn, các ngày trước giữ mức cũ. Ngày nào kế toán đã nhập số riêng ở tab “Chi phí theo ngày” thì dùng số đó.
      </p>
      <Notice notice={notice} />

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          {PER_ORDER_FIELDS.map(({ key, label }) => (
            <div key={key} className="w-40 space-y-1">
              <Label htmlFor={`rate-${key}`} className="text-[11px] text-muted-foreground">
                {label} (₱/sản phẩm)
              </Label>
              <MoneyInput
                id={`rate-${key}`}
                className="h-8 text-right text-xs tabular-nums"
                value={form[key]}
                disabled={loading || configured === false}
                onValueChange={(raw) => setForm((value) => ({ ...value, [key]: raw }))}
              />
            </div>
          ))}
          <div className="w-40 space-y-1">
            <Label htmlFor="rate-effective" className="text-[11px] text-muted-foreground">
              Có hiệu lực từ ngày
            </Label>
            <Input
              id="rate-effective"
              type="date"
              className="h-8 text-xs"
              value={effectiveDate}
              disabled={loading || configured === false}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </div>
          <Button size="sm" disabled={!valid || saving || loading || configured === false} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Lưu đơn giá
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={loading} onClick={() => setForm(toForm(DEFAULT_PER_ORDER_RATES))}>
            <RotateCcw />
            Về mức mặc định
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Giao hàng bán mỗi sản phẩm = PED → Phi + bên Phi = {money.format(shippingPerOrder({ ...DEFAULT_PER_ORDER_RATES, shippingPedPh: Number(form.shippingPedPh) || 0, shippingPh: Number(form.shippingPh) || 0 }))} ₱.
          {" "}Đang áp dụng hôm nay: {current ? PER_ORDER_FIELDS.map(({ key, label }) => `${label} ${money.format(inForce[key])}`).join(" · ") : "…"}
          {current && !current.rates.length ? " (mức mặc định, chưa lưu bộ đơn giá nào)" : ""}.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table className="text-xs">
          <TableHeader className="bg-muted/50 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead>Hiệu lực từ</TableHead>
              {PER_ORDER_FIELDS.map(({ key, label }) => (
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
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                  <LoaderCircle className="mr-1.5 inline size-3.5 animate-spin" />
                  Đang tải…
                </TableCell>
              </TableRow>
            ) : sorted.length ? (
              sorted.map((entry) => (
                <TableRow key={entry.effectiveDate}>
                  <TableCell className="whitespace-nowrap font-medium">{toDmy(entry.effectiveDate)}</TableCell>
                  {PER_ORDER_FIELDS.map(({ key }) => (
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
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                  Chưa lưu bộ đơn giá nào: báo cáo đang dùng mức mặc định ({PER_ORDER_FIELDS.map(({ key }) => money.format(DEFAULT_PER_ORDER_RATES[key])).join(" / ")} ₱ mỗi sản phẩm).
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
