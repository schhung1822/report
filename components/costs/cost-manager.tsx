"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { CogsRatesPanel } from "@/components/costs/cogs-rates-panel";
import { DailyCostSheet } from "@/components/costs/daily-cost-sheet";
import { LegacyTotalsPanel } from "@/components/costs/legacy-totals-panel";
import { OrderRatesPanel } from "@/components/costs/order-rates-panel";
import { ShopPayPanel } from "@/components/costs/shop-pay-panel";
import { StaffPayPanel } from "@/components/costs/staff-pay-panel";
import { Notice, type NoticeState } from "@/components/notice";
import { PageHeader } from "@/components/report-ui";
import { ConfigSection, ReportWorkspace } from "@/components/report-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { expandCostEntries } from "@/lib/costs/expand";
import {
  CHANNELS,
  CHANNEL_LABELS,
  COST_PERIODS,
  COST_PERIOD_LABELS,
  COST_SCOPES,
  COST_SCOPE_LABELS,
  COST_TYPES,
  COST_TYPE_LABELS,
  type CostChannel,
  type CostEntry,
  type CostPeriod,
  type CostScopeKind,
  type CostType,
} from "@/lib/costs/types";
import { toDmy } from "@/lib/pancake/dates";
import type { ManualCostRow, PancakeShop } from "@/lib/pancake/types";
import { dayCount, localDate, RANGE_PRESETS } from "@/lib/range-presets";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";
const INPUT = "h-8 px-2 text-xs";
const LABEL = "text-[11px] text-muted-foreground";

type Tab = "staff" | "pay" | "sheet" | "rates" | "cogs" | "legacy" | "entries" | "preview";
type ScopeFilter = "all" | CostScopeKind;

type FormState = {
  costType: CostType;
  label: string;
  amount: string;
  period: CostPeriod;
  scope: CostScopeKind;
  channel: CostChannel;
  staffName: string;
  validFrom: string;
  validTo: string;
  note: string;
  /** Số công chuẩn; only for a monthly amount of a staff member. */
  workDays: string;
};

function emptyForm(shop: PancakeShop | undefined, today = ""): FormState {
  return {
    costType: "fixed_cost",
    label: "",
    amount: "",
    period: "monthly",
    scope: shop?.currency.toUpperCase() === "PHP" ? "shop" : "channel",
    channel: "zalo",
    staffName: "",
    validFrom: today,
    validTo: "",
    note: "",
    workDays: "",
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

function scopeText(entry: Pick<CostEntry, "scope" | "channel" | "staffName">) {
  if (entry.scope === "channel" && entry.channel) return `Kênh ${CHANNEL_LABELS[entry.channel]}`;
  if (entry.scope === "staff") return `Nhân sự: ${entry.staffName}`;
  return COST_SCOPE_LABELS.shop;
}

function Field({ id, label, className, children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className={LABEL}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function CostManager() {
  const [shops, setShops] = useState<PancakeShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [loadedFor, setLoadedFor] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [form, setForm] = useState<FormState>(() => emptyForm(undefined));
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [tab, setTab] = useState<Tab>("sheet");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  /** One date range for the whole page: the accountant's sheet and the allocation preview both read it. */
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const shop = shops.find((item) => String(item.id) === shopId);
  /** The monthly amount of a staff member can be split over the standard working days instead of the calendar days. */
  const perWorkDay = form.scope === "staff" && form.period === "monthly";
  const loading = Boolean(shopId) && loadedFor !== shopId;
  const money = useMemo(() => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }), []);
  const isPhilippines = shop?.currency.toUpperCase() === "PHP";
  const unit = isPhilippines ? "₱" : "₫";
  /** The per-order rates only exist for the Philippines shop: another shop falls back to the first tab. */
  const activeTab: Tab = (tab === "rates" || tab === "cogs" || tab === "legacy") && !isPhilippines ? "sheet" : tab === "pay" && isPhilippines ? "sheet" : tab;
  const rangeValid = Boolean(from) && Boolean(to) && from <= to;
  const days = rangeValid ? dayCount(from, to) : 0;

  useEffect(() => {
    let cancelled = false;
    request<{ shops: PancakeShop[]; defaultShopId: number | null }>("/api/pancake/shops", { method: "POST", body: "{}" })
      .then(({ shops: list, defaultShopId }) => {
        if (cancelled) return;
        const first = list.find((item) => item.id === defaultShopId) ?? list[0];
        const today = localDate();
        setShops(list);
        setShopId(first ? String(first.id) : "");
        setForm(emptyForm(first, today));
        setFrom(`${today.slice(0, 7)}-01`);
        setTo(today);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ type: "error", message: error instanceof Error ? error.message : "Không tải được danh sách shop." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    request<{ configured: boolean; entries: CostEntry[] }>(`/api/costs?shopId=${shopId}`)
      .then((result) => {
        if (cancelled) return;
        setConfigured(result.configured);
        setEntries(result.entries);
        setLoadedFor(shopId);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setLoadedFor(shopId);
        setNotice({ type: "error", message: error instanceof Error ? error.message : "Không đọc được danh sách chi phí." });
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, reloadToken]);

  const preview = useMemo(() => {
    const rows = rangeValid ? expandCostEntries(entries, from, to) : [];
    const totals = new Map<string, number>();
    const add = (row: ManualCostRow, type: CostType, amount: number) => {
      if (amount <= 0) return;
      const key = `${scopeText({ scope: row.staff ? "staff" : row.channel ? "channel" : "shop", channel: row.channel ?? null, staffName: row.staff ?? null })}|${type}`;
      totals.set(key, Math.round(((totals.get(key) ?? 0) + amount) * 100) / 100);
    };
    for (const row of rows) {
      add(row, "salary_sale_cskh", row.salarySaleCskh);
      add(row, "salary_other", row.salaryOther);
      add(row, "fixed_cost", row.fixedCost);
      add(row, "other_cost", row.otherCost);
      add(row, "ads_cost", row.adsCost);
      add(row, "return_provision", row.returnProvision);
    }
    return Array.from(totals, ([key, total]) => {
      const [scope, type] = key.split("|");
      return { scope, type: type as CostType, total };
    }).sort((a, b) => a.scope.localeCompare(b.scope) || a.type.localeCompare(b.type));
  }, [entries, from, to, rangeValid]);

  const previewTotal = preview.reduce((sum, line) => sum + line.total, 0);
  const counts = useMemo(() => {
    const result: Record<ScopeFilter, number> = { all: entries.length, shop: 0, channel: 0, staff: 0 };
    for (const entry of entries) result[entry.scope] += 1;
    return result;
  }, [entries]);
  const shown = scopeFilter === "all" ? entries : entries.filter((entry) => entry.scope === scopeFilter);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setFormOpen(false);
    setForm(emptyForm(shop, localDate()));
  }

  function startEdit(entry: CostEntry) {
    setEditingId(entry.id);
    setFormOpen(true);
    setTab("entries");
    setForm({
      costType: entry.costType,
      label: entry.label,
      amount: String(entry.amount),
      period: entry.period,
      scope: entry.scope,
      channel: entry.channel ?? "zalo",
      staffName: entry.staffName ?? "",
      validFrom: entry.validFrom,
      validTo: entry.validTo ?? "",
      note: entry.note ?? "",
      workDays: entry.workDays ? String(entry.workDays) : "",
    });
    setNotice(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!shopId) return;
    setSaving(true);
    setNotice(null);
    const body = JSON.stringify({
      shopId: Number(shopId),
      scope: form.scope,
      channel: form.scope === "channel" ? form.channel : null,
      staffName: form.scope === "staff" ? form.staffName : null,
      costType: form.costType,
      label: form.label,
      amount: form.amount === "" ? NaN : Number(form.amount),
      period: form.period,
      validFrom: form.validFrom,
      validTo: form.period === "once" ? form.validFrom : form.validTo || null,
      note: form.note || null,
      workDays: perWorkDay && form.workDays ? Number(form.workDays) : null,
    });
    try {
      await request(editingId ? `/api/costs/${editingId}` : "/api/costs", { method: editingId ? "PUT" : "POST", body });
      setNotice({ type: "success", message: editingId ? "Đã cập nhật khoản chi phí." : "Đã thêm khoản chi phí." });
      resetForm();
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu khoản chi phí." });
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: CostEntry) {
    if (!window.confirm(`Xóa khoản “${entry.label || COST_TYPE_LABELS[entry.costType]}”? Báo cáo các kỳ đã chạy lại sẽ thay đổi theo.`)) return;
    try {
      await request(`/api/costs/${entry.id}?shopId=${entry.shopId}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Đã xóa khoản chi phí." });
      if (editingId === entry.id) resetForm();
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể xóa khoản chi phí." });
    }
  }

  const triggerClass = "gap-1.5 px-3 text-xs font-semibold";

  return (
    <ReportWorkspace
      header={
        <PageHeader
          title="Chi phí cố định"
          description="Chi phí không có trong Pancake POS. Nhập chi phí theo ngày (giá vốn, phí giao hàng, chi phí khác), lương nhân sự và các khoản cố định hằng tháng; báo cáo tự lấy khi đồng bộ."
        />
      }
      aside={
        <>
          <ConfigSection title="Shop">
            <select
              aria-label="Shop"
              value={shopId}
              onChange={(event) => {
                setShopId(event.target.value);
                resetForm();
              }}
              disabled={shops.length === 0}
              className={CONTROL}
            >
              {shops.length === 0 ? <option value="">Chưa có shop</option> : null}
              {shops.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.currency})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {shop ? `Số tiền tính bằng ${shop.currency.toUpperCase() === "PHP" ? "peso (₱)" : "đồng (₫)"}.` : "Đang tải danh sách shop…"}
            </p>
          </ConfigSection>

          <ConfigSection title="Khoảng ngày">
            <div className="grid grid-cols-2 gap-2">
              <Field id="range-from" label="Từ ngày">
                <Input id="range-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={INPUT} />
              </Field>
              <Field id="range-to" label="Đến ngày">
                <Input id="range-to" type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} className={INPUT} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-1">
              {RANGE_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="xs"
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
            <p className={cn("text-[11px]", rangeValid || !from ? "text-muted-foreground" : "text-destructive")}>
              {rangeValid ? `${days} ngày · dùng cho bảng kế toán và xem trước phân bổ` : from ? "“Từ ngày” phải trước hoặc bằng “Đến ngày”." : ""}
            </p>
          </ConfigSection>

          <ConfigSection title="Quy tắc tính" collapsible defaultOpen={false}>
            <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
              <li>Chi phí cố định hằng tháng (thuê mặt bằng, phần mềm…) nhập một lần, hệ thống tự chia đều ra từng ngày. Hằng tháng: chia đều theo số ngày của tháng. Hằng ngày: mỗi ngày đúng số đó. Một lần: tính vào đúng ngày phát sinh.</li>
              <li>Lương nhân sự nhập ở tab “Lương nhân sự” (bấm Quét nhân viên): lương ÷ số công chuẩn, chỉ tính ngày nhân viên có đơn trong POS. Shop Phil: lương + thưởng cả tháng quy ra peso theo tỷ giá trung bình rồi chia cho từng ngày theo doanh thu ngày ÷ doanh thu cả tháng (không dùng số công chuẩn).</li>
              <li>Chi phí ads không nhập: lấy tự động từ Ads Meta của các tài khoản đã gắn nhãn shop.</li>
              <li>Chi phí theo ngày: Việt Nam nhập giá vốn hoàn, chi phí cố định/khác của từng kênh; Phil: giá vốn tính theo danh mục (tab “Giá vốn theo danh mục”: số sản phẩm bán ra × giá vốn trung bình), chỉ nhập giá vốn từng ngày khi muốn thay số của ngày đó; dịch vụ mua ngoài, giao hàng, chi phí khác, thuế/phí tự tính theo số sản phẩm bán ra × đơn giá ở tab “Đơn giá theo sản phẩm”, chỉ nhập khi muốn thay số của một ngày. Ngày nào có số thì thay cho số ước tính hằng tháng của đúng ngày và khoản đó.</li>
            </ul>
          </ConfigSection>
        </>
      }
    >
      {configured === false ? (
        <Notice
          notice={{
            type: "warning",
            message:
              "Chưa cấu hình MySQL. Chạy file database/schema.sql trên database của bạn, rồi điền MYSQL_URL (hoặc MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE) vào .env.local và khởi động lại server.",
          }}
        />
      ) : null}
      <Notice notice={notice} />

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as Tab)} className="gap-3">
        <div className="overflow-x-auto">
          <TabsList className="h-9 min-w-max gap-1 border p-1 shadow-xs">
            <TabsTrigger value="sheet" className={triggerClass}>
              Chi phí theo ngày
            </TabsTrigger>
            {isPhilippines ? (
              <TabsTrigger value="cogs" className={triggerClass}>
                Giá vốn theo danh mục
              </TabsTrigger>
            ) : null}
            {isPhilippines ? (
              <TabsTrigger value="rates" className={triggerClass}>
                Đơn giá theo sản phẩm
              </TabsTrigger>
            ) : null}
            {isPhilippines ? (
              <TabsTrigger value="legacy" className={triggerClass}>
                Shop Phil cũ
              </TabsTrigger>
            ) : null}
            {!isPhilippines ? (
              <TabsTrigger value="pay" className={triggerClass}>
                Lương & định phí tổng
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="staff" className={triggerClass}>
              Lương nhân sự
            </TabsTrigger>
            <TabsTrigger value="entries" className={triggerClass}>
              Chi phí cố định hằng tháng
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {entries.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="preview" className={triggerClass}>
              Xem trước phân bổ
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="staff">
          <StaffPayPanel shop={shop} configured={configured} from={from} to={to} onSaved={() => setReloadToken((token) => token + 1)} />
        </TabsContent>

        <TabsContent value="pay">
          <ShopPayPanel shop={shop} configured={configured} onSaved={() => setReloadToken((token) => token + 1)} />
        </TabsContent>

        <TabsContent value="cogs">
          <CogsRatesPanel shop={shop} configured={configured} />
        </TabsContent>

        <TabsContent value="rates">
          <OrderRatesPanel shop={shop} configured={configured} />
        </TabsContent>

        <TabsContent value="legacy">
          <LegacyTotalsPanel shop={shop} configured={configured} />
        </TabsContent>

        <TabsContent value="sheet">
          <DailyCostSheet shop={shop} configured={configured} from={from} to={to} />
        </TabsContent>

        <TabsContent value="entries" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ["all", "Tất cả"],
                  ["shop", "Cả shop"],
                  ["channel", "Theo kênh"],
                  ["staff", "Theo nhân sự"],
                ] as const
              ).map(([value, label]) => (
                <Button key={value} size="xs" variant={scopeFilter === value ? "default" : "outline"} onClick={() => setScopeFilter(value)}>
                  {label} ({counts[value]})
                </Button>
              ))}
            </div>
            {formOpen ? null : (
              <Button size="sm" disabled={!shopId || configured === false} onClick={() => setFormOpen(true)}>
                <Plus />
                Thêm khoản
              </Button>
            )}
          </div>

          {formOpen ? (
            <Card size="sm">
              <CardContent>
                <form onSubmit={(event) => void save(event)} className="space-y-3">
                  <p className="text-sm font-medium">{editingId ? "Sửa khoản chi phí" : "Thêm khoản chi phí"}</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field id="cost-type" label="Loại chi phí">
                      <select id="cost-type" className={CONTROL} value={form.costType} onChange={(event) => update("costType", event.target.value as CostType)}>
                        {COST_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {COST_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="cost-label" label="Tên khoản">
                      <Input id="cost-label" className={INPUT} placeholder="Ví dụ: Thuê mặt bằng" maxLength={160} value={form.label} onChange={(event) => update("label", event.target.value)} />
                    </Field>
                    <Field id="cost-amount" label={`Số tiền (${unit === "₱" && form.scope === "staff" ? "₫, quy đổi sang ₱ trong báo cáo" : unit})`}>
                      <Input id="cost-amount" className={INPUT} type="number" min="0" step="0.01" inputMode="decimal" required value={form.amount} onChange={(event) => update("amount", event.target.value)} />
                    </Field>
                    <Field id="cost-period" label="Chu kỳ">
                      <select id="cost-period" className={CONTROL} value={form.period} onChange={(event) => update("period", event.target.value as CostPeriod)}>
                        {COST_PERIODS.map((period) => (
                          <option key={period} value={period}>
                            {COST_PERIOD_LABELS[period]}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field id="cost-scope" label="Tính cho">
                      <select id="cost-scope" className={CONTROL} value={form.scope} onChange={(event) => update("scope", event.target.value as CostScopeKind)}>
                        {COST_SCOPES.map((scope) => (
                          <option key={scope} value={scope}>
                            {COST_SCOPE_LABELS[scope]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {form.scope === "channel" ? (
                      <Field id="cost-channel" label="Kênh">
                        <select id="cost-channel" className={CONTROL} value={form.channel} onChange={(event) => update("channel", event.target.value as CostChannel)}>
                          {CHANNELS.map((channel) => (
                            <option key={channel} value={channel}>
                              {CHANNEL_LABELS[channel]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    {form.scope === "staff" ? (
                      <Field id="cost-staff" label="Tên nhân sự (đúng như trong POS)">
                        <Input id="cost-staff" className={INPUT} required maxLength={120} value={form.staffName} onChange={(event) => update("staffName", event.target.value)} />
                      </Field>
                    ) : null}
                    <Field id="cost-from" label={form.period === "once" ? "Ngày phát sinh" : "Hiệu lực từ"}>
                      <Input id="cost-from" className={INPUT} type="date" required value={form.validFrom} onChange={(event) => update("validFrom", event.target.value)} />
                    </Field>
                    {form.period !== "once" ? (
                      <Field id="cost-to" label="Đến ngày (trống = chưa kết thúc)">
                        <Input id="cost-to" className={INPUT} type="date" min={form.validFrom || undefined} value={form.validTo} onChange={(event) => update("validTo", event.target.value)} />
                      </Field>
                    ) : null}
                    {perWorkDay ? (
                      <Field id="cost-work-days" label="Số công chuẩn (trống = chia đều theo ngày)">
                        <Input id="cost-work-days" className={INPUT} type="number" min="1" max="31" step="1" inputMode="numeric" placeholder="Ví dụ: 26" value={form.workDays} onChange={(event) => update("workDays", event.target.value)} />
                      </Field>
                    ) : null}
                    <Field id="cost-note" label="Ghi chú" className="sm:col-span-2">
                      <Input id="cost-note" className={INPUT} maxLength={255} value={form.note} onChange={(event) => update("note", event.target.value)} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={saving || !shopId || configured === false}>
                      {saving ? <LoaderCircle className="animate-spin" /> : editingId ? <Pencil /> : <Plus />}
                      {editingId ? "Lưu thay đổi" : "Thêm khoản chi phí"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                      <X />
                      {editingId ? "Hủy sửa" : "Đóng"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table className="text-xs">
              <TableHeader className="bg-muted/50 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Khoản chi phí</TableHead>
                  <TableHead>Tính cho</TableHead>
                  <TableHead className="text-right">Số tiền ({unit})</TableHead>
                  <TableHead>Chu kỳ</TableHead>
                  <TableHead>Hiệu lực</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody className="[&_td]:px-3 [&_td]:py-2">
                {shown.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {loading ? "Đang tải…" : entries.length ? "Không có khoản nào thuộc nhóm này." : "Chưa có khoản chi phí nào."}
                    </TableCell>
                  </TableRow>
                ) : (
                  shown.map((entry) => (
                    <TableRow key={entry.id} className={cn(editingId === entry.id && "bg-muted/40")}>
                      <TableCell>
                        <span className="block font-medium">{entry.label || COST_TYPE_LABELS[entry.costType]}</span>
                        {entry.label ? <span className="block text-[11px] text-muted-foreground">{COST_TYPE_LABELS[entry.costType]}</span> : null}
                      </TableCell>
                      <TableCell>{scopeText(entry)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money.format(entry.amount)}
                        {unit === "₱" && entry.scope === "staff" ? <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">₫</span> : null}
                      </TableCell>
                      <TableCell>
                        {COST_PERIOD_LABELS[entry.period].replace(" (chia đều theo ngày)", "")}
                        {entry.workDays ? <span className="block text-[11px] text-muted-foreground">{entry.workDays} công chuẩn, chỉ ngày có đơn</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {toDmy(entry.validFrom)}
                        {entry.period === "once" ? "" : ` → ${entry.validTo ? toDmy(entry.validTo) : "chưa kết thúc"}`}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-0.5">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Sửa" onClick={() => startEdit(entry)}>
                            <Pencil />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Xóa" onClick={() => void remove(entry)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="preview" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Chi phí của các khoản cố định / hằng tháng rơi vào {rangeValid ? `${toDmy(from)} – ${toDmy(to)}` : "khoảng ngày đã chọn"}, tính đúng như khi đồng bộ. Khoản có số công
            chuẩn chỉ tính ngày nhân sự có đơn nên ở đây tạm tính đủ mọi ngày; số chính xác có trong báo cáo. Thưởng được tính chung vào dòng lương. Chưa gồm bảng kế toán theo
            ngày.
          </p>
          {preview.length ? (
            <div className="overflow-x-auto rounded-lg border">
              <Table className="text-xs">
                <TableHeader className="bg-muted/50 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tính cho</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead className="text-right">Tổng trong khoảng ({unit})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_td]:px-3 [&_td]:py-2">
                  {preview.map((line) => (
                    <TableRow key={`${line.scope}|${line.type}`}>
                      <TableCell>{line.scope}</TableCell>
                      <TableCell>{COST_TYPE_LABELS[line.type]}</TableCell>
                      <TableCell className="text-right tabular-nums">{money.format(line.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={2} className="px-3 py-2 font-semibold">
                      Tổng
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right font-semibold tabular-nums">{money.format(Math.round(previewTotal * 100) / 100)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">Không có chi phí nào rơi vào khoảng ngày này.</p>
          )}
        </TabsContent>
      </Tabs>
    </ReportWorkspace>
  );
}
