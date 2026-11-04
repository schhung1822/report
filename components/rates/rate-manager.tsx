"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { Notice, type NoticeState } from "@/components/notice";
import { PageHeader } from "@/components/report-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toDmy } from "@/lib/pancake/dates";
import { latestRate, RATE_PAIR, type ExchangeRateEntry } from "@/lib/rates/rates";

type FormState = { rate: string; effectiveDate: string; note: string };

function localDate(base = new Date()) {
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

export function RateManager() {
  const [rates, setRates] = useState<ExchangeRateEntry[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [today, setToday] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [form, setForm] = useState<FormState>({ rate: "", effectiveDate: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const number = useMemo(() => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }), []);

  useEffect(() => {
    let cancelled = false;
    request<{ configured: boolean; rates: ExchangeRateEntry[] }>("/api/rates")
      .then((result) => {
        if (cancelled) return;
        const now = localDate();
        setConfigured(result.configured);
        setRates(result.rates);
        setToday(now);
        setForm((current) => ({ ...current, effectiveDate: current.effectiveDate || now }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setToday(localDate());
        setNotice({ type: "error", message: error instanceof Error ? error.message : "Không đọc được danh sách tỷ giá." });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const current = today ? latestRate(rates, today) : null;
  const sameDay = rates.find((entry) => entry.effectiveDate === form.effectiveDate);

  function startEdit(entry: ExchangeRateEntry) {
    setForm({ rate: String(entry.rate), effectiveDate: entry.effectiveDate, note: entry.note ?? "" });
    setNotice(null);
  }

  function resetForm() {
    setForm({ rate: "", effectiveDate: today, note: "" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await request("/api/rates", {
        method: "POST",
        body: JSON.stringify({
          fromCurrency: RATE_PAIR.from,
          toCurrency: RATE_PAIR.to,
          rate: form.rate === "" ? NaN : Number(form.rate),
          effectiveDate: form.effectiveDate,
          note: form.note || null,
        }),
      });
      setNotice({ type: "success", message: sameDay ? "Đã cập nhật tỷ giá của ngày này." : "Đã thêm tỷ giá mới. Báo cáo sẽ dùng mức này từ ngày hiệu lực." });
      resetForm();
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu tỷ giá." });
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: ExchangeRateEntry) {
    if (!window.confirm(`Xóa tỷ giá ${number.format(entry.rate)} (từ ${toDmy(entry.effectiveDate)})? Báo cáo tạo lại sau đó sẽ dùng mức khác.`)) return;
    try {
      await request(`/api/rates/${entry.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Đã xóa tỷ giá." });
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể xóa tỷ giá." });
    }
  }

  function statusOf(entry: ExchangeRateEntry) {
    if (entry.effectiveDate > today) return <Badge variant="outline">Chưa hiệu lực</Badge>;
    if (current && entry.id === current.id) return <Badge className="bg-emerald-50 text-emerald-700">Đang áp dụng</Badge>;
    return <Badge variant="secondary">Đã thay thế</Badge>;
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Tỷ giá"
        description={`Tỷ giá ${RATE_PAIR.from} → ${RATE_PAIR.to} do bạn đặt. Báo cáo luôn dùng mức mới nhất đã có hiệu lực.`}
      />

      {configured === false ? (
        <Notice
          notice={{
            type: "warning",
            message:
              "Chưa cấu hình MySQL. Chạy file database/schema.sql, điền MYSQL_URL (hoặc MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE) vào .env.local và khởi động lại server.",
          }}
        />
      ) : null}
      <Notice notice={notice} />

      <Card>
        <CardHeader>
          <CardTitle>Tỷ giá đang áp dụng</CardTitle>
          <CardDescription>Mọi ngày trong báo cáo Philippines được quy đổi bằng mức này.</CardDescription>
        </CardHeader>
        <CardContent>
          {current ? (
            <p className="text-2xl font-semibold tabular-nums">
              1 {RATE_PAIR.from} = {number.format(current.rate)} {RATE_PAIR.to}
              <span className="ml-3 text-sm font-normal text-muted-foreground">hiệu lực từ {toDmy(current.effectiveDate)}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có tỷ giá nào đang có hiệu lực.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nhập tỷ giá mới</CardTitle>
          <CardDescription>
            Nhập mức mới và ngày bắt đầu hiệu lực; mức cũ được giữ trong lịch sử. Nhập lại đúng một ngày đã có thì sửa mức của ngày đó.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="rate-value">
                  1 {RATE_PAIR.from} = ? {RATE_PAIR.to}
                </Label>
                <Input id="rate-value" className="h-9" type="number" min="0" step="any" inputMode="decimal" required value={form.rate} onChange={(event) => setForm((state) => ({ ...state, rate: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-date">Hiệu lực từ ngày</Label>
                <Input id="rate-date" className="h-9" type="date" required value={form.effectiveDate} onChange={(event) => setForm((state) => ({ ...state, effectiveDate: event.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rate-note">Ghi chú</Label>
                <Input id="rate-note" className="h-9" maxLength={255} placeholder="Ví dụ: tỷ giá nội bộ tháng 11" value={form.note} onChange={(event) => setForm((state) => ({ ...state, note: event.target.value }))} />
              </div>
            </div>
            {sameDay ? (
              <p className="text-xs text-amber-700">
                Ngày {toDmy(sameDay.effectiveDate)} đã có tỷ giá {number.format(sameDay.rate)}; lưu sẽ thay bằng mức mới.
              </p>
            ) : null}
            {form.effectiveDate && today && form.effectiveDate > today ? (
              <p className="text-xs text-muted-foreground">Ngày này ở tương lai: tỷ giá chỉ được dùng từ ngày đó, đến lúc đó vẫn dùng mức hiện tại.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={saving || configured === false}>
                {saving ? <LoaderCircle className="animate-spin" /> : sameDay ? <Pencil /> : <Plus />}
                {sameDay ? "Cập nhật tỷ giá" : "Thêm tỷ giá"}
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={resetForm}>
                <X />
                Xóa nội dung đã nhập
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lịch sử tỷ giá</CardTitle>
          <CardDescription>{rates.length} mức, mới nhất ở trên.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hiệu lực từ</TableHead>
                <TableHead className="text-right">1 {RATE_PAIR.from} = ({RATE_PAIR.to})</TableHead>
                <TableHead className="text-right">So với mức trước</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Ghi chú</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Chưa có tỷ giá nào.
                  </TableCell>
                </TableRow>
              ) : (
                rates.map((entry, index) => {
                  const previous = rates[index + 1];
                  const delta = previous ? entry.rate - previous.rate : null;
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">{toDmy(entry.effectiveDate)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{number.format(entry.rate)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${delta ? (delta > 0 ? "text-emerald-600" : "text-destructive") : "text-muted-foreground"}`}>
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${number.format(Math.round(delta * 1e6) / 1e6)}`}
                      </TableCell>
                      <TableCell>{today ? statusOf(entry) : null}</TableCell>
                      <TableCell className="max-w-xs truncate">{entry.note ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Sửa" onClick={() => startEdit(entry)}>
                            <Pencil />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Xóa" onClick={() => void remove(entry)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
