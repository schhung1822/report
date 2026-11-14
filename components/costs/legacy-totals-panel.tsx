"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Save, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/costs/money-input";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LegacyTotals } from "@/lib/pancake/legacy-totals";
import type { PancakeShop } from "@/lib/pancake/types";

type Form = { label: string; revenue: string; confirmed: string; returned: string; orders: string; refunded: string; note: string };
type Loaded = { shopId: number; totals: LegacyTotals | null };

const EMPTY: Form = { label: "", revenue: "", confirmed: "", returned: "", orders: "", refunded: "", note: "" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

const toForm = (totals: LegacyTotals | null): Form =>
  totals
    ? {
        label: totals.label ?? "",
        revenue: String(totals.revenue),
        confirmed: String(totals.confirmed),
        returned: String(totals.returned),
        orders: String(totals.orders),
        refunded: String(totals.refunded),
        note: totals.note ?? "",
      }
    : EMPTY;

const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Philippines: the totals of a shop that no longer sells. The accountant's "Tổng cộng dồn" still contains it, while the app only reads
 * the live shops, so these numbers are added to the whole-history card of section IV (never to a day, the month or the profit).
 */
export function LegacyTotalsPanel({ shop, configured }: { shop: PancakeShop | undefined; configured: boolean | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const shopId = shop?.id ?? 0;
  const current = loaded?.shopId === shopId ? loaded : null;
  const loading = Boolean(shopId) && configured !== false && !current;

  useEffect(() => {
    if (!shopId || configured === false) return;
    let cancelled = false;
    request<{ totals: LegacyTotals | null }>(`/api/costs/legacy-totals?shopId=${shopId}`)
      .then(({ totals }) => {
        if (cancelled) return;
        setLoaded({ shopId, totals });
        setForm(toForm(totals));
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ type: "error", message: error instanceof Error ? error.message : "Không tải được số của shop Phil cũ." });
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, configured, reloadToken]);

  const number = (text: string) => (text === "" ? 0 : Number(text));
  const valid = (["revenue", "confirmed", "returned", "orders", "refunded"] as const).every((key) => Number.isFinite(number(form[key])) && number(form[key]) >= 0);
  const rate = number(form.confirmed) > 0 ? (number(form.returned) / number(form.confirmed)) * 100 : null;

  async function save() {
    if (!shop || !valid) return;
    setSaving(true);
    setNotice(null);
    try {
      await request("/api/costs/legacy-totals", {
        method: "PUT",
        body: JSON.stringify({
          shopId: shop.id,
          label: form.label,
          revenue: number(form.revenue),
          confirmed: number(form.confirmed),
          returned: number(form.returned),
          orders: number(form.orders),
          refunded: number(form.refunded),
          note: form.note,
        }),
      });
      setLoaded(null);
      setReloadToken((token) => token + 1);
      setNotice({ type: "success", message: "Đã lưu. Báo cáo đã lấy trước đó chưa đổi: hãy lấy lại dữ liệu để thẻ “Tổng cộng dồn” cộng thêm số này." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!shop || !window.confirm("Xóa số của shop Phil cũ? Thẻ “Tổng cộng dồn” sẽ chỉ còn các shop đang chạy.")) return;
    setNotice(null);
    try {
      await request(`/api/costs/legacy-totals?shopId=${shop.id}`, { method: "DELETE" });
      setLoaded(null);
      setReloadToken((token) => token + 1);
      setNotice({ type: "success", message: "Đã xóa. Hãy lấy lại dữ liệu báo cáo để áp dụng." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể xóa." });
    }
  }

  const disabled = loading || configured === false;
  const moneyField = (key: "revenue" | "confirmed" | "returned", label: string, hint: string) => (
    <div className="w-56 space-y-1">
      <Label htmlFor={`legacy-${key}`} className="text-[11px] text-muted-foreground">
        {label} (₱)
      </Label>
      <MoneyInput
        id={`legacy-${key}`}
        className="h-8 text-right text-xs tabular-nums"
        value={form[key]}
        disabled={disabled}
        onValueChange={(raw) => setForm((value) => ({ ...value, [key]: raw }))}
      />
      <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>
    </div>
  );
  const countField = (key: "orders" | "refunded", label: string, hint: string) => (
    <div className="w-40 space-y-1">
      <Label htmlFor={`legacy-${key}`} className="text-[11px] text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`legacy-${key}`}
        inputMode="numeric"
        className="h-8 text-right text-xs tabular-nums"
        value={form[key]}
        disabled={disabled}
        onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value.replace(/\D/g, "") }))}
      />
      <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-xs text-muted-foreground">
        Shop Phil đã ngừng hoạt động không còn đọc được từ Pancake, nhưng báo cáo của kế toán vẫn cộng nó vào “Tổng cộng dồn”. Nhập tổng cộng dồn của shop đó ở đây: các số này được cộng vào thẻ
        “Tổng cộng dồn” ở mục IV của báo cáo Phil (cả số tiền, tỷ lệ hoàn và số đơn hoàn/đơn). Không ảnh hưởng thẻ “Lũy kế tháng”, báo cáo theo ngày hay lợi nhuận. Mỗi nhóm shop Phil chỉ có một bộ số, lưu lại
        sẽ thay bộ cũ.
      </p>
      <Notice notice={notice} />

      <div className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-56 space-y-1">
            <Label htmlFor="legacy-label" className="text-[11px] text-muted-foreground">
              Tên shop cũ
            </Label>
            <Input id="legacy-label" className="h-8 text-xs" value={form.label} disabled={disabled} maxLength={190} onChange={(event) => setForm((value) => ({ ...value, label: event.target.value }))} />
          </div>
          {moneyField("revenue", "Doanh số cộng vào thẻ", "Số tiền cộng thêm vào số hiện ở thẻ “Tổng cộng dồn”.")}
          {moneyField("confirmed", "Doanh số thành công", "Mẫu số của tỷ lệ hoàn.")}
          {moneyField("returned", "Giá trị đơn hoàn", "Tử số của tỷ lệ hoàn.")}
          {countField("orders", "Số đơn", "Mẫu số của “đơn hoàn/đơn”.")}
          {countField("refunded", "Số đơn hoàn", "Tử số của “đơn hoàn/đơn”.")}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-md space-y-1">
            <Label htmlFor="legacy-note" className="text-[11px] text-muted-foreground">
              Ghi chú
            </Label>
            <Input id="legacy-note" className="h-8 text-xs" value={form.note} disabled={disabled} maxLength={190} onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))} />
          </div>
          <Button size="sm" disabled={!valid || saving || disabled} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Lưu
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled || !current?.totals} onClick={() => void remove()}>
            <Trash2 />
            Xóa
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {loading
            ? "Đang tải…"
            : `Riêng shop cũ: tỷ lệ hoàn ${rate === null ? "—" : `${percent.format(rate)}%`}, ${money.format(number(form.refunded))}/${money.format(number(form.orders))} đơn hoàn.`}
          {current?.totals ? ` Đã lưu${current.totals.updatedBy ? ` bởi ${current.totals.updatedBy}` : ""}${current.totals.updatedAt ? ` lúc ${current.totals.updatedAt}` : ""}.` : current ? " Chưa lưu số nào: báo cáo chưa cộng gì." : ""}
        </p>
      </div>
    </div>
  );
}
