"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LoaderCircle, Save } from "lucide-react";
import { MoneyInput } from "@/components/costs/money-input";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dailyRate } from "@/lib/costs/expand";
import { activeOn, isPerWorkDay, STAFF_COST_LABELS, STAFF_COST_TYPES, staffEntries, type StaffCostType } from "@/lib/costs/staff";
import { MAX_WORK_DAYS, type CostEntry } from "@/lib/costs/types";
import { UNASSIGNED_STAFF } from "@/lib/pancake/dataset";
import { monthStart } from "@/lib/pancake/dates";
import type { PancakeSyncResult } from "@/lib/pancake/types";
import { normalizeText } from "@/lib/workbook";

/** The staff the table lists, and what they did in the range it describes. */
export type StaffCostSource = {
  shopId: number;
  currency: string;
  /** Last day of the range: the “áp dụng từ” date starts on the first of its month. */
  to: string;
  staff: { name: string; revenue: number; department?: string | null; orders?: number }[];
  /** One row per staff member and day with orders (what the estimate of the range is made of); absent in old saved reports. */
  staffDays?: { name: string; date: string }[];
};

/** The table of a synced report lists the staff of its POS data. */
export function staffSourceOfResult(result: PancakeSyncResult): StaffCostSource {
  return {
    shopId: result.shop.id,
    currency: result.shop.currency,
    to: result.range.to,
    staff: result.dataset.staff
      .filter((staff) => staff.name !== UNASSIGNED_STAFF)
      .map((staff) => ({ name: staff.name, revenue: staff.facts.created.revenue, orders: staff.facts.created.totalOrderCount })),
    staffDays: result.dataset.staffDays,
  };
}

type Props = {
  source: StaffCostSource;
  /** Called after the values were saved (a report page rebuilds its report with them). */
  onSaved: () => void;
  /** Inside a dialog that already has a title: drop the own divider. */
  embedded?: boolean;
  /**
   * "report": under a synced report, saving also refreshes that report. "page": on the cost page, where nothing else needs
   * refreshing and the table is not a guest of another page.
   */
  variant?: "report" | "page";
};

type Cell = { value: number; editable: boolean; note: string | null; workDays: number | null };

/** The usual number of working days of a month, offered until one is saved. */
const DEFAULT_WORK_DAYS = 26;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

/** What is charged for one person and cost type on `date`, and whether this table may edit it. */
function currentCell(entries: CostEntry[], staffName: string, costType: StaffCostType, date: string): Cell {
  const active = activeOn(staffEntries(entries, staffName, costType), date);
  if (active.length === 0) return { value: 0, editable: true, note: null, workDays: null };
  const value = Math.round(active.reduce((total, entry) => total + entry.amount, 0) * 100) / 100;
  if (active.length > 1) return { value, editable: false, note: `${active.length} khoản`, workDays: null };
  if (active[0].period !== "monthly") {
    return { value, editable: false, note: active[0].period === "daily" ? "hằng ngày" : "một lần", workDays: null };
  }
  return { value, editable: true, note: null, workDays: active[0].workDays };
}

/**
 * Table shown after a sync: one row per staff member of the shop, with the monthly salary, bonus and fixed cost that the
 * report should use from a given date. Pay (salary and bonus) is split over the standard working days of the month and
 * costs only the days the person had orders, so a report of one day costs one day of pay. Values are stored in MySQL, so
 * they only have to be entered once.
 */
export function StaffCostTable({ source, onSaved, embedded = false, variant = "report" }: Props) {
  const shopId = source.shopId;
  const unit = source.currency.toUpperCase() === "PHP" ? "₱" : "₫";
  const onReport = variant === "report";

  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [validFrom, setValidFrom] = useState(monthStart(source.to));
  const [workDaysDraft, setWorkDaysDraft] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const money = useMemo(() => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }), []);

  const loadKey = `${shopId}:${reloadToken}`;

  useEffect(() => {
    let cancelled = false;
    request<{ configured: boolean; entries: CostEntry[] }>(`/api/costs?shopId=${shopId}`)
      .then((response) => {
        if (cancelled) return;
        setConfigured(response.configured);
        setEntries(response.entries);
        setLoadedKey(`${shopId}:${reloadToken}`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice({ type: "error", message: error instanceof Error ? error.message : "Không đọc được chi phí nhân sự." });
        setLoadedKey(`${shopId}:${reloadToken}`);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, reloadToken]);

  const staffDays = source.staffDays;
  /** Days with orders or revenue of each staff member in the range: the days their pay is charged. */
  const daysWorked = useMemo(() => {
    const byName = new Map<string, Set<string>>();
    for (const day of staffDays ?? []) {
      const key = normalizeText(day.name);
      const dates = byName.get(key) ?? new Set<string>();
      dates.add(day.date);
      byName.set(key, dates);
    }
    return byName;
  }, [staffDays]);

  const rows = useMemo(() => {
    // Biggest revenue first, so the people who sell the most are at the top.
    const byName = new Map<string, { name: string; revenue: number; department: string | null; orders: number | null }>();
    for (const staff of source.staff) {
      if (staff.name === UNASSIGNED_STAFF) continue;
      byName.set(normalizeText(staff.name), { name: staff.name, revenue: staff.revenue, department: staff.department ?? null, orders: staff.orders ?? null });
    }
    // Staff that only exist in the saved costs (no orders in this range) stay editable.
    for (const entry of entries) {
      if (entry.scope === "staff" && entry.staffName && !byName.has(normalizeText(entry.staffName))) {
        byName.set(normalizeText(entry.staffName), { name: entry.staffName, revenue: 0, department: null, orders: null });
      }
    }
    return Array.from(byName.values()).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  }, [source.staff, entries]);

  const draftKey = (name: string, type: StaffCostType) => `${normalizeText(name)}|${type}`;

  // The standard working days saved for the pay that applies on the chosen date, else the usual 26.
  const storedWorkDays = useMemo(() => {
    for (const row of rows) {
      for (const type of STAFF_COST_TYPES) {
        const days = isPerWorkDay(type) ? currentCell(entries, row.name, type, validFrom).workDays : null;
        if (days) return days;
      }
    }
    return null;
  }, [rows, entries, validFrom]);
  const workDaysText = workDaysDraft ?? String(storedWorkDays ?? DEFAULT_WORK_DAYS);
  const workDays = /^\d+$/.test(workDaysText.trim()) && Number(workDaysText) >= 1 && Number(workDaysText) <= MAX_WORK_DAYS ? Number(workDaysText) : null;

  /** The amount typed in a cell, or the stored one while nothing was typed. */
  const amountOf = (name: string, type: StaffCostType) => {
    const draft = drafts[draftKey(name, type)];
    if (draft === undefined) return currentCell(entries, name, type, validFrom).value;
    const typed = draft.trim() === "" ? 0 : Number(draft);
    return Number.isFinite(typed) && typed >= 0 ? typed : 0;
  };

  /** Items whose typed value (or the working days) differs from the stored one. */
  const changes = useMemo(() => {
    const items: { staffName: string; costType: StaffCostType; amount: number; workDays: number | null }[] = [];
    for (const row of rows) {
      for (const type of STAFF_COST_TYPES) {
        const cell = currentCell(entries, row.name, type, validFrom);
        const draft = drafts[draftKey(row.name, type)];
        const amount = draft === undefined ? cell.value : draft.trim() === "" ? 0 : Number(draft);
        if (!cell.editable || !Number.isFinite(amount) || amount < 0) continue;
        const itemDays = isPerWorkDay(type) ? workDays : null;
        // Changing the standard working days re-saves the pay of everyone who has some.
        const daysChanged = isPerWorkDay(type) && amount > 0 && cell.workDays !== itemDays;
        if (amount !== cell.value || daysChanged) items.push({ staffName: row.name, costType: type, amount, workDays: itemDays });
      }
    }
    return items;
  }, [rows, drafts, entries, validFrom, workDays]);

  const needsWorkDays = changes.some((item) => isPerWorkDay(item.costType) && item.amount > 0);
  const canSave = !saving && changes.length > 0 && Boolean(validFrom) && !(needsWorkDays && workDays === null);

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      await request("/api/costs/staff", { method: "POST", body: JSON.stringify({ shopId, validFrom, items: changes }) });
      setDrafts({});
      setWorkDaysDraft(null);
      setReloadToken((token) => token + 1);
      setNotice({ type: "success", message: `Đã lưu ${changes.length} giá trị.${onReport ? " Đang cập nhật báo cáo…" : " Lấy lại dữ liệu ở trang báo cáo để áp dụng."}` });
      onSaved();
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể lưu chi phí nhân sự." });
    } finally {
      setSaving(false);
    }
  }

  const loading = loadedKey !== loadKey;

  if (configured === false) {
    return (
      <p className="text-xs text-muted-foreground">
        Muốn nhập lương/định phí từng nhân sự, hãy cấu hình MySQL (xem README, mục “Chi phí cố định”).
      </p>
    );
  }

  return (
    <div className={embedded ? "space-y-3" : "space-y-3 border-t pt-4"}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Chi phí theo nhân sự</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Nhập <strong>lương cứng</strong>, <strong>thưởng</strong> mỗi tháng ({unit}) và <strong>số công chuẩn</strong>. Chi phí TB mỗi ngày = (lương + thưởng) ÷ số công
            chuẩn, chỉ tính cho ngày nhân sự có đơn hoặc doanh thu. Đổi mức thì chọn ngày áp dụng mới, các kỳ trước giữ nguyên.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="staff-work-days" className="text-xs text-muted-foreground">
              Số công chuẩn / tháng
            </Label>
            <Input
              id="staff-work-days"
              type="number"
              min="1"
              max={MAX_WORK_DAYS}
              step="1"
              inputMode="numeric"
              className="h-9 w-32"
              aria-invalid={workDays === null}
              value={workDaysText}
              onChange={(event) => setWorkDaysDraft(event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-from" className="text-xs text-muted-foreground">
              Áp dụng từ ngày
            </Label>
            <Input id="staff-from" type="date" className="h-9 w-40" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} disabled={saving} />
          </div>
          <Button size="lg" className="h-9" disabled={!canSave} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Lưu {changes.length ? `${changes.length} thay đổi` : ""}
            {onReport ? " & cập nhật báo cáo" : ""}
          </Button>
        </div>
      </div>
      {workDays === null ? <p className="text-xs text-destructive">Số công chuẩn phải là số ngày nguyên từ 1 đến {MAX_WORK_DAYS}.</p> : null}

      <Notice notice={notice} />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nhân sự</TableHead>
              {STAFF_COST_TYPES.map((type) => (
                <TableHead key={type} className="w-36">
                  {STAFF_COST_LABELS[type]} / tháng
                </TableHead>
              ))}
              <TableHead className="text-right">TB / ngày công</TableHead>
              <TableHead className="text-right">Tạm tính kỳ này</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={STAFF_COST_TYPES.length + 3} className="py-6 text-center text-muted-foreground">
                  {loading ? "Đang tải…" : "POS chưa gán đơn cho nhân sự nào trong khoảng ngày này."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const days = staffDays ? (daysWorked.get(normalizeText(row.name))?.size ?? 0) : null;
                const monthlyPay = amountOf(row.name, "salary_sale_cskh") + amountOf(row.name, "bonus");
                const perDay = workDays ? dailyRate(monthlyPay, workDays) : 0;
                return (
                  <TableRow key={normalizeText(row.name)}>
                    <TableCell className="font-medium">
                      {row.name}
                      {row.department || row.orders !== null ? (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {[row.department, row.orders !== null && row.orders > 0 ? `${row.orders} đơn` : null].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </TableCell>
                    {STAFF_COST_TYPES.map((type) => (
                      <TableCell key={type}>{costInput(row.name, type)}</TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{perDay ? money.format(perDay) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {days === null || !perDay ? (
                        "—"
                      ) : (
                        <>
                          {money.format(Math.round(perDay * days * 100) / 100)}
                          <span className="block text-xs font-normal text-muted-foreground">{days} ngày có đơn</span>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        “Tạm tính kỳ này” = TB/ngày × số ngày có đơn trong kỳ đang xem. Thưởng tính chung vào lương và lặp lại mỗi tháng đến khi bạn đổi hoặc nhập 0 từ ngày áp dụng mới.
        Định phí chia đều theo ngày của tháng.
        {staffDays ? null : " Báo cáo đã lưu này chưa có số ngày có đơn: bấm “Lấy dữ liệu” để cập nhật."}{" "}
        {onReport ? (
          <>
            Nhân sự lấy từ các đơn trong kỳ. Chi phí theo kênh, cả shop và khoản khác quản lý tại{" "}
            <Link href="/fixed-costs" className="underline">
              trang Chi phí cố định
            </Link>
            .
          </>
        ) : (
          "Bấm “Quét nhân viên” để thêm nhân viên mới của POS vào bảng."
        )}
      </p>
    </div>
  );

  function costInput(name: string, type: StaffCostType) {
    const cell = currentCell(entries, name, type, validFrom);
    const key = draftKey(name, type);
    if (!cell.editable) {
      return (
        <span className="text-xs text-muted-foreground">
          {money.format(cell.value)} ({cell.note}) ·{" "}
          <Link href="/fixed-costs" className="underline">
            sửa tại trang Chi phí
          </Link>
        </span>
      );
    }
    return (
      <MoneyInput
        aria-label={`${STAFF_COST_LABELS[type]} của ${name}`}
        className="h-8 text-right tabular-nums"
        placeholder="0"
        disabled={saving || loading}
        value={drafts[key] ?? (cell.value ? String(cell.value) : "")}
        onValueChange={(raw) => setDrafts((current) => ({ ...current, [key]: raw }))}
      />
    );
  }
}
