"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { MoneyInput } from "@/components/costs/money-input";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SHOP_PAY_LABELS, SHOP_PAY_TYPES, shopPayEntries, type ShopPayType } from "@/lib/costs/shop-pay";
import type { CostEntry } from "@/lib/costs/types";
import { toDmy } from "@/lib/pancake/dates";
import type { PancakeShop } from "@/lib/pancake/types";
import { localDate } from "@/lib/range-presets";

type Loaded = { shopId: number; entries: CostEntry[]; today: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

/** The monthly total of a type that is in force on `date`. */
function inForce(entries: CostEntry[], costType: ShopPayType, date: string) {
  return shopPayEntries(entries, costType)
    .filter((entry) => entry.validFrom <= date && (entry.validTo === null || entry.validTo >= date))
    .reduce((sum, entry) => sum + entry.amount, 0);
}

/**
 * Vietnam shop: the monthly totals of the whole shop. The two salaries (Sale/CSKH, other departments) are shared out by revenue:
 * a day's salary = monthly total x revenue of the day / revenue of the month. The fixed cost and the other fixed cost are divided
 * evenly over the days of the month. Nothing is typed per person or per day.
 */
export function ShopPayPanel({ shop, configured, onSaved }: { shop: PancakeShop | undefined; configured: boolean | null; onSaved: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Record<ShopPayType, string>>({ salary_sale_cskh: "", salary_other: "", fixed_cost: "", other_cost: "" });
  const [validFrom, setValidFrom] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const shopId = shop?.id ?? 0;
  const current = loaded?.shopId === shopId ? loaded : null;
  const loading = Boolean(shopId) && configured !== false && !current;
  const history = useMemo(
    () =>
      SHOP_PAY_TYPES.flatMap((type) => shopPayEntries(current?.entries ?? [], type)).sort((a, b) => b.validFrom.localeCompare(a.validFrom) || a.costType.localeCompare(b.costType)),
    [current],
  );

  useEffect(() => {
    if (!shopId || configured === false) return;
    let cancelled = false;
    request<{ entries: CostEntry[] }>(`/api/costs?shopId=${shopId}`)
      .then(({ entries }) => {
        if (cancelled) return;
        const today = localDate();
        setLoaded({ shopId, entries, today });
        setForm(Object.fromEntries(SHOP_PAY_TYPES.map((type) => [type, String(inForce(entries, type, today) || "")])) as Record<ShopPayType, string>);
        setValidFrom((date) => date || `${today.slice(0, 7)}-01`);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ type: "error", message: error instanceof Error ? error.message : "Không tải được chi phí tổng." });
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, configured, reloadToken]);

  const amounts = SHOP_PAY_TYPES.map((type) => ({ type, amount: Number(form[type] || 0) }));
  const valid = Boolean(validFrom) && amounts.every(({ amount }) => Number.isFinite(amount) && amount >= 0);

  async function save() {
    if (!shop || !valid) return;
    setSaving(true);
    setNotice(null);
    try {
      await request("/api/costs/shop-pay", {
        method: "POST",
        body: JSON.stringify({ shopId: shop.id, validFrom, items: amounts.map(({ type, amount }) => ({ costType: type, amount })) }),
      });
      setLoaded(null);
      setReloadToken((token) => token + 1);
      onSaved();
      setNotice({
        type: "success",
        message: `Đã lưu chi phí tổng áp dụng từ ${toDmy(validFrom)}. Bảng lợi nhuận và đối soát sẽ tự đọc lại các ngày bị ảnh hưởng; báo cáo đã lấy trước đó cần lấy lại dữ liệu.`,
      });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu chi phí tổng." });
    } finally {
      setSaving(false);
    }
  }

  const total = amounts.reduce((sum, { amount }) => sum + (Number.isFinite(amount) ? amount : 0), 0);

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-xs text-muted-foreground">
        Nhập tổng mỗi tháng của lương Sale/CSKH, lương các bộ phận khác, định phí và định phí khác. Lương chia cho từng ngày theo doanh thu: lương ngày = lương tháng × doanh thu ngày ÷
        doanh thu cả tháng (tháng đã kết thúc: các ngày cộng lại đúng bằng lương tháng; tháng đang chạy: doanh thu cả tháng là số dự tính từ các ngày đã qua). Định phí và định phí khác
        chia đều cho số ngày của tháng (ví dụ tháng 30 ngày: mỗi ngày bằng tổng ÷ 30). Số có hiệu lực từ ngày chọn, các tháng trước giữ số cũ. Khi đã nhập tổng, khoản tương ứng theo
        từng nhân sự chỉ còn dùng cho Báo cáo hiệu suất, báo cáo quản trị không cộng thêm.
      </p>
      <Notice notice={notice} />

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          {SHOP_PAY_TYPES.map((type) => (
            <div key={type} className="w-52 space-y-1">
              <Label htmlFor={`shop-pay-${type}`} className="text-[11px] text-muted-foreground">
                {SHOP_PAY_LABELS[type]} (₫/tháng)
              </Label>
              <MoneyInput
                id={`shop-pay-${type}`}
                className="h-8 text-right text-xs tabular-nums"
                value={form[type]}
                disabled={loading || configured === false}
                onValueChange={(raw) => setForm((value) => ({ ...value, [type]: raw }))}
              />
            </div>
          ))}
          <div className="w-40 space-y-1">
            <Label htmlFor="shop-pay-from" className="text-[11px] text-muted-foreground">
              Áp dụng từ ngày
            </Label>
            <Input id="shop-pay-from" type="date" className="h-8 text-xs" value={validFrom} disabled={loading || configured === false} onChange={(event) => setValidFrom(event.target.value)} />
          </div>
          <Button size="sm" disabled={!valid || saving || loading || configured === false} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Lưu lương tổng
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Tổng các khoản mỗi tháng: {money.format(total)} ₫. Đang áp dụng hôm nay:{" "}
          {current ? SHOP_PAY_TYPES.map((type) => `${SHOP_PAY_LABELS[type]} ${money.format(inForce(current.entries, type, current.today))} ₫`).join(" · ") : "…"}. Để trống hoặc 0 = không tính khoản đó từ ngày áp dụng.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table className="text-xs">
          <TableHeader className="bg-muted/50 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead>Khoản</TableHead>
              <TableHead className="text-right">Số tiền mỗi tháng</TableHead>
              <TableHead>Từ ngày</TableHead>
              <TableHead>Đến ngày</TableHead>
              <TableHead>Lưu bởi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:px-3 [&_td]:py-2">
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  <LoaderCircle className="mr-1.5 inline size-3.5 animate-spin" />
                  Đang tải…
                </TableCell>
              </TableRow>
            ) : history.length ? (
              history.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{SHOP_PAY_LABELS[entry.costType as ShopPayType]}</TableCell>
                  <TableCell className="text-right tabular-nums">{money.format(entry.amount)} ₫</TableCell>
                  <TableCell className="whitespace-nowrap">{toDmy(entry.validFrom)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{entry.validTo ? toDmy(entry.validTo) : "đang áp dụng"}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.createdBy ?? "—"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  Chưa nhập chi phí tổng: báo cáo đang dùng các khoản theo từng nhân sự / hằng tháng đã nhập (nếu có).
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
