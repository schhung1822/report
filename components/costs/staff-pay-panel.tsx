"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, ScanSearch } from "lucide-react";
import { StaffCostTable, type StaffCostSource } from "@/components/costs/staff-cost-table";
import { Notice, type NoticeState } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { toDmy } from "@/lib/pancake/dates";
import type { PancakeShop, StaffScan } from "@/lib/pancake/types";

async function scanRequest(shopId: number, from: string, to: string): Promise<StaffScan> {
  const response = await fetch("/api/pancake/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shopId, from, to }),
  });
  const payload = (await response.json().catch(() => null)) as (StaffScan & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể quét nhân viên từ Pancake POS.");
  return payload;
}

/**
 * Staff pay of a shop (Vietnam or Philippines): “Quét nhân viên” reads the POS employees and what each sold in the page's
 * date range, then the table takes the monthly pay, bonus and fixed cost of each person. Pay is entered here and charged per
 * working day; ad spend is not entered anywhere, it is read from Meta.
 */
export function StaffPayPanel({
  shop,
  configured,
  from,
  to,
  onSaved,
}: {
  shop: PancakeShop | undefined;
  configured: boolean | null;
  from: string;
  to: string;
  onSaved: () => void;
}) {
  const [scan, setScan] = useState<StaffScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showIdle, setShowIdle] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const rangeValid = Boolean(from) && Boolean(to) && from <= to;
  // A scan belongs to the shop it was made for; switching shops shows the saved pay until the new shop is scanned.
  const current = scan && shop && scan.shop.id === shop.id ? scan : null;

  const source = useMemo<StaffCostSource | null>(() => {
    if (!shop) return null;
    const people = current?.staff ?? [];
    const shown = showIdle ? people : people.filter((person) => person.orders > 0 || person.revenue !== 0 || person.days.length > 0);
    return {
      shopId: shop.id,
      currency: shop.currency,
      to: current?.range.to ?? to,
      staff: shown.map((person) => ({ name: person.name, revenue: person.revenue, department: person.department, orders: person.orders })),
      staffDays: current ? people.flatMap((person) => person.days.map((date) => ({ name: person.name, date }))) : undefined,
    };
  }, [shop, current, showIdle, to]);

  const active = current ? current.staff.filter((person) => person.orders > 0 || person.revenue !== 0 || person.days.length > 0).length : 0;
  const idle = current ? current.staff.length - active : 0;

  async function runScan() {
    if (!shop || !rangeValid) return;
    setScanning(true);
    setNotice(null);
    try {
      const result = await scanRequest(shop.id, from, to);
      setScan(result);
      const found = result.staff.filter((person) => person.orders > 0 || person.revenue !== 0).length;
      setNotice({
        type: "success",
        message: `Đã quét ${result.staff.length} nhân viên của ${result.shop.name}: ${found} người có đơn trong ${toDmy(result.range.from)} – ${toDmy(result.range.to)}.`,
      });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể quét nhân viên." });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-xs text-muted-foreground">
          Nhập lương cứng, thưởng và định phí mỗi tháng của từng nhân viên; lương tính theo số công chuẩn, chỉ những ngày nhân viên có đơn. Chi phí ads không nhập ở đây: lấy tự
          động từ Ads Meta.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {current && idle > 0 ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" className="size-3.5" checked={showIdle} onChange={(event) => setShowIdle(event.target.checked)} />
              Hiện cả {idle} nhân viên chưa có đơn
            </label>
          ) : null}
          <Button size="sm" disabled={!shop || !rangeValid || scanning || configured === false} onClick={() => void runScan()}>
            {scanning ? <LoaderCircle className="animate-spin" /> : <ScanSearch />}
            {current ? "Quét lại" : "Quét nhân viên"}
          </Button>
        </div>
      </div>
      {!rangeValid && from ? <p className="text-xs text-destructive">Chọn khoảng ngày hợp lệ ở thanh bên để quét.</p> : null}
      {current ? (
        <p className="text-[11px] text-muted-foreground">
          Quét lúc {new Date(current.fetchedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · {active} người có đơn trong {toDmy(current.range.from)} –{" "}
          {toDmy(current.range.to)}
          {idle ? `, ${idle} người chưa có đơn` : ""}.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">Đang hiện nhân viên đã có lương lưu trong hệ thống. Bấm “Quét nhân viên” để thêm nhân viên đang có trong POS.</p>
      )}
      <Notice notice={notice} />

      {source ? <StaffCostTable key={source.shopId} source={source} variant="page" embedded onSaved={onSaved} /> : null}
    </div>
  );
}
