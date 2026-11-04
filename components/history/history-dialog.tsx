"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, TriangleAlert, Trash2 } from "lucide-react";
import { Notice, type NoticeState } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCreatedAt, type SnapshotMeta } from "@/lib/history/summary";
import { toDmy } from "@/lib/pancake/dates";
import type { PancakeSyncResult } from "@/lib/pancake/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only list reports of shops in these currencies. */
  currencies?: string[];
  /** The reports currently on screen, marked in the list. */
  currentIds?: number[];
  /** Called with the stored report the user opened. */
  onOpenReport: (result: PancakeSyncResult) => void;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Không thể kết nối tới máy chủ.");
  return payload;
}

export function HistoryDialog({ open, onOpenChange, currencies, currentIds, onOpenReport }: Props) {
  const [items, setItems] = useState<SnapshotMeta[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const currencyParam = currencies?.join(",") ?? "";
  const requestKey = `${currencyParam}:${reloadToken}`;
  const loading = open && loadedKey !== requestKey;
  const number = useMemo(() => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    request<{ configured: boolean; items: SnapshotMeta[] }>(`/api/history?limit=100${currencyParam ? `&currency=${currencyParam}` : ""}`)
      .then((result) => {
        if (cancelled) return;
        setConfigured(result.configured);
        setItems(result.items);
        // Keep only selections that still exist after a reload of the list.
        setSelected((current) => new Set(result.items.filter((item) => current.has(item.id)).map((item) => item.id)));
        setLoadedKey(`${currencyParam}:${reloadToken}`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setItems([]);
        setNotice({ type: "error", message: error instanceof Error ? error.message : "Không đọc được lịch sử báo cáo." });
        setLoadedKey(`${currencyParam}:${reloadToken}`);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currencyParam, reloadToken]);

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openReport(item: SnapshotMeta) {
    setBusy(true);
    setNotice(null);
    try {
      const { snapshot } = await request<{ snapshot: PancakeSyncResult }>(`/api/history/${item.id}`);
      onOpenReport(snapshot);
      onOpenChange(false);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không mở được báo cáo." });
      setReloadToken((token) => token + 1);
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!window.confirm(`Xóa ${ids.length} báo cáo đã chọn? Việc này không thể hoàn tác.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const { deleted } = await request<{ deleted: number }>("/api/history", { method: "DELETE", body: JSON.stringify({ ids }) });
      setNotice({ type: "success", message: `Đã xóa ${deleted} báo cáo.` });
      setSelected(new Set());
      setReloadToken((token) => token + 1);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Không thể xóa báo cáo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Lịch sử báo cáo</DialogTitle>
          <DialogDescription>
            Mỗi lần lấy dữ liệu từ Pancake đều được lưu lại. Mở để xem lại đúng số liệu lúc đó, hoặc xóa các bản không cần.
          </DialogDescription>
        </DialogHeader>

        {configured === false ? (
          <Notice notice={{ type: "warning", message: "Chưa cấu hình MySQL nên chưa có lịch sử báo cáo. Xem README, mục “Chi phí cố định”." }} />
        ) : null}
        <Notice notice={notice} />

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{loading ? "Đang tải…" : `${items.length} báo cáo (mới nhất ở trên)`}</p>
          <Button variant="destructive" size="sm" disabled={busy || !selected.size} onClick={() => void removeSelected()}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            Xóa đã chọn{selected.size ? ` (${selected.size})` : ""}
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả"
                    className="size-4 accent-foreground"
                    checked={allSelected}
                    disabled={!items.length || busy}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))}
                  />
                </TableHead>
                <TableHead>Lưu lúc</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Kỳ báo cáo</TableHead>
                <TableHead className="text-right">Doanh thu thực tế</TableHead>
                <TableHead className="text-right">Đơn</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {loading ? "Đang tải…" : "Chưa có báo cáo nào được lưu."}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Chọn báo cáo ${item.id}`}
                        className="size-4 accent-foreground"
                        checked={selected.has(item.id)}
                        disabled={busy}
                        onChange={() => toggle(item.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatCreatedAt(item.createdAt)}</TableCell>
                    <TableCell className="max-w-48 truncate">
                      {item.shopName} <span className="text-muted-foreground">({item.currency})</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.rangeFrom === item.rangeTo ? toDmy(item.rangeFrom) : `${toDmy(item.rangeFrom)} – ${toDmy(item.rangeTo)}`}
                      <span className="ml-1 text-muted-foreground">· {item.dayCount} ngày</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number.format(item.revenue)} {item.currency === "PHP" ? "₱" : "₫"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{number.format(item.orderCount)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {currentIds?.includes(item.id) ? <Badge className="bg-emerald-50 text-emerald-700">Đang xem</Badge> : null}
                        {item.hasAlarm ? (
                          <Badge variant="destructive" className="gap-1">
                            <TriangleAlert className="size-3" aria-hidden="true" />
                            Đối soát lệch
                          </Badge>
                        ) : null}
                        {item.warningCount ? <span className="text-xs text-muted-foreground">{item.warningCount} ghi chú</span> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void openReport(item)}>
                        Mở
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
