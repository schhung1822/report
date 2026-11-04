"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { DailyFlowChart } from "@/components/charts/report-charts";
import { cellClass, ReportSection, signedTextClass, StatCard, TableFrame, tableHeaderClass } from "@/components/report-ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rangeLabel } from "@/lib/pancake/dates";
import { groupRows, RECONCILE_WINDOWS, reconcileSummary, type CumulativeReconciliation, type ReconcileWindow } from "@/lib/pancake/status";
import { cn } from "@/lib/utils";
import { formatPeso, formatVnd } from "@/utils/finance";

const countFormatter = new Intl.NumberFormat("vi-VN");
const percentFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

const percent = (value: number | null) => (value === null ? "—" : `${percentFormatter.format(value)}%`);
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

type Entry = { data?: CumulativeReconciliation; error?: string };

/**
 * "Đối soát lũy kế": where the orders of the last 20-30 days ending on the report's last day stand now (received, on the
 * way, returned, canceled). A one or two day report has hardly any returns yet, so this looks back over a longer window.
 * A Philippines shop reads in pesos; `rate` shows them in VND underneath/above like the rest of that report.
 */
export function CumulativeReconciliationSection({
  index,
  shopId,
  to,
  currency,
  rate,
}: {
  index: string;
  shopId: number;
  /** The last day of the report: the last day of every window. */
  to: string;
  currency: "VND" | "PHP";
  /** VND per peso (Philippines only). */
  rate?: number;
}) {
  const [windowDays, setWindowDays] = useState<ReconcileWindow>(30);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const inFlight = useRef(new Set<string>());
  const key = `${shopId}|${to}|${windowDays}`;
  const entry = entries[key];

  useEffect(() => {
    if (entries[key] || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    fetch("/api/pancake/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopId, to, windowDays, rate }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (CumulativeReconciliation & { error?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.error ?? "Không đối soát được từ Pancake POS.");
        return body;
      })
      .then((data) => setEntries((previous) => ({ ...previous, [key]: { data } })))
      .catch((error: unknown) =>
        setEntries((previous) => ({ ...previous, [key]: { error: error instanceof Error ? error.message : "Không đối soát được từ Pancake POS." } })),
      )
      .finally(() => inFlight.current.delete(key));
  }, [entries, key, shopId, to, windowDays, rate]);

  function retry() {
    setEntries((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  const data = entry?.data;
  return (
    <ReportSection
      index={index}
      title="Đối soát lũy kế"
      description={data ? `${data.windowDays} ngày · ${rangeLabel(data.from, data.to)}` : `${windowDays} ngày kết thúc ${rangeLabel(to, to)}`}
      className="break-inside-auto"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Mốc đối soát">
        <span className="mr-1 text-xs text-muted-foreground">Mốc đối soát:</span>
        {RECONCILE_WINDOWS.map((days) => (
          <Button key={days} size="xs" variant={days === windowDays ? "default" : "outline"} aria-pressed={days === windowDays} onClick={() => setWindowDays(days)}>
            {days} ngày
          </Button>
        ))}
      </div>

      {data ? (
        <ReconciliationBody data={data} currency={currency} rate={rate} />
      ) : entry?.error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <span>{entry.error}</span>
          <Button size="xs" variant="outline" onClick={retry}>
            <RefreshCw />
            Thử lại
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Đang đối soát {windowDays} ngày với Pancake POS…
        </div>
      )}
    </ReportSection>
  );
}

export function ReconciliationBody({ data, currency, rate }: { data: CumulativeReconciliation; currency: "VND" | "PHP"; rate?: number }) {
  const summary = reconcileSummary(data.rows);
  const groups = groupRows(data.rows);
  const decided = summary.received.orders + summary.returned.orders;
  const toVnd = (amount: number) => (currency === "PHP" ? amount * (rate ?? 0) : amount);
  // "+ 0" turns a negative zero (an empty group taken off a total) into a plain 0.
  const main = (amount: number) => formatVnd(toVnd(amount) + 0);
  const sub = (amount: number) => (currency === "PHP" ? `(${formatPeso(amount + 0)})` : undefined);
  const withSub = (amount: number, extra?: string) => [sub(amount), extra].filter(Boolean).join(" · ") || undefined;

  if (!data.rows.length) {
    return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">Pancake POS không có đơn nào trong {data.windowDays} ngày này.</p>;
  }

  return (
    <div className="space-y-4">
      <DailyFlowChart
        title={`Doanh thu và lợi nhuận theo ngày · ${data.windowDays} ngày`}
        days={data.daily.map((day) => ({ date: day.date, moneyIn: day.revenue, moneyOut: day.revenue - day.profit }))}
        currency="VND"
        moneyInLabel="Doanh thu"
        netLabel="Lợi nhuận"
        totalLabel="Tổng lợi nhuận"
      />

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Tổng đơn trên POS"
          value={countFormatter.format(summary.all.orders)}
          helper={`Giá trị ${main(summary.all.amount)}${currency === "PHP" ? ` ${sub(summary.all.amount)}` : ""}`}
        />
        <StatCard
          label="Doanh thu sau huỷ"
          value={main(summary.estimated.amount)}
          helper={withSub(summary.estimated.amount, `${countFormatter.format(summary.estimated.orders)} đơn`)}
        />
        <StatCard
          label="Doanh thu sau hoàn"
          value={main(summary.actual.amount)}
          helper={withSub(summary.actual.amount, `${countFormatter.format(summary.actual.orders)} đơn`)}
          tone={summary.actual.amount < 0 ? "negative" : "default"}
        />
        <StatCard
          label="Tỷ lệ hoàn"
          value={percent(summary.returnRate)}
          helper={`${countFormatter.format(summary.returned.orders)}/${countFormatter.format(decided)} đơn đã có kết quả`}
          tone={summary.returnRate !== null && summary.returnRate >= 15 ? "negative" : "default"}
        />
      </div>

      <TableFrame>
        <Table className="text-xs">
          <TableHeader className={tableHeaderClass}>
            <TableRow className="hover:bg-transparent">
              <TableHead>Trạng thái đơn</TableHead>
              <TableHead className="text-right">Số đơn</TableHead>
              <TableHead className="text-right">% số đơn</TableHead>
              <TableHead className="text-right">Giá trị</TableHead>
              <TableHead className="text-right">% giá trị</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const bad = group.group === "returned" || group.group === "canceled";
              return (
                <TableRow key={group.group} className="break-inside-avoid">
                  <TableCell className={cellClass}>
                    <span className="font-medium">{group.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{group.hint}</span>
                  </TableCell>
                  <TableCell className={cn(cellClass, "text-right tabular-nums")}>{countFormatter.format(group.orders)}</TableCell>
                  <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>{percent(share(group.orders, summary.all.orders))}</TableCell>
                  <Amount value={group.amount} main={main} sub={sub} className={bad ? "text-destructive" : undefined} />
                  <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>{percent(share(group.amount, summary.all.amount))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className={cn(cellClass, "font-semibold")}>Tổng đơn trên POS</TableCell>
              <TableCell className={cn(cellClass, "text-right font-semibold tabular-nums")}>{countFormatter.format(summary.all.orders)}</TableCell>
              <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>100%</TableCell>
              <Amount value={summary.all.amount} main={main} sub={sub} strong />
              <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>100%</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableFrame>

      <TableFrame>
        <Table className="text-xs">
          <TableHeader className={tableHeaderClass}>
            <TableRow className="hover:bg-transparent">
              <TableHead>Đối soát</TableHead>
              <TableHead className="text-right">Số đơn</TableHead>
              <TableHead className="text-right">Giá trị</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Line label="Giá trị đơn trên POS" orders={summary.all.orders} amount={summary.all.amount} main={main} sub={sub} />
            <Line label="− Đơn huỷ" orders={summary.canceled.orders} amount={-summary.canceled.amount} main={main} sub={sub} negative />
            <Line label="= Đơn không huỷ" orders={summary.estimated.orders} amount={summary.estimated.amount} main={main} sub={sub} strong />
            <Line label="− Đơn hoàn" orders={summary.returned.orders} amount={-summary.returned.amount} main={main} sub={sub} negative />
            <Line label="= Đơn không huỷ, không hoàn" orders={summary.actual.orders} amount={summary.actual.amount} main={main} sub={sub} strong shaded />
            <Line label="– Đã nhận hàng" orders={summary.received.orders} amount={summary.received.amount} main={main} sub={sub} indent />
            <Line label="– Đang giao" orders={summary.shipping.orders} amount={summary.shipping.amount} main={main} sub={sub} indent />
            <Line label="– Chờ xử lý / chờ giao" orders={summary.waiting.orders} amount={summary.waiting.amount} main={main} sub={sub} indent />
          </TableBody>
        </Table>
      </TableFrame>

      <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
        <li>
          Tỷ lệ huỷ <strong className="text-foreground">{percent(summary.canceledRate)}</strong> số đơn · còn <strong className="text-foreground">{percent(summary.openRate)}</strong> đơn chưa giao xong (chờ xử lý + đang giao).
        </li>
        <li>Giá trị là số trên bộ lọc đơn của POS (COD + chuyển khoản trước). Đơn hoàn một phần được tính cả giá trị đơn vào “Hoàn”.</li>
        <li>Lợi nhuận theo ngày trừ giá vốn, vận chuyển và chi phí đã lưu trên MySQL (lương, định phí, ads Meta); chi phí nạp từ file trên trang không được tính ở mục này.</li>
        {currency === "PHP" ? <li>Quy đổi VNĐ theo tỷ giá 1 ₱ = {countFormatter.format(rate ?? 0)} ₫ (ngày cuối của kỳ).</li> : null}
        {data.includesToday ? <li className="text-amber-700">Mốc này gồm hôm nay nên đơn mới vẫn đang thay đổi trạng thái.</li> : null}
        {data.warnings.map((warning) => (
          <li key={warning} className="text-amber-700">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Amount({
  value,
  main,
  sub,
  strong = false,
  className,
}: {
  value: number;
  main: (amount: number) => string;
  sub: (amount: number) => string | undefined;
  strong?: boolean;
  className?: string;
}) {
  const peso = sub(value);
  return (
    <TableCell className={cn(cellClass, "text-right tabular-nums")}>
      <span className={cn("block", strong && "font-semibold", className)}>{main(value)}</span>
      {peso ? <span className="block text-[11px] text-muted-foreground">{peso}</span> : null}
    </TableCell>
  );
}

function Line({
  label,
  orders,
  amount,
  main,
  sub,
  strong = false,
  shaded = false,
  negative = false,
  indent = false,
}: {
  label: ReactNode;
  orders: number;
  amount: number;
  main: (amount: number) => string;
  sub: (amount: number) => string | undefined;
  strong?: boolean;
  shaded?: boolean;
  negative?: boolean;
  indent?: boolean;
}) {
  return (
    <TableRow className={cn("break-inside-avoid hover:bg-transparent", shaded && "bg-muted/40")}>
      <TableCell className={cn(cellClass, strong && "font-semibold", indent && "pl-8 text-muted-foreground")}>{label}</TableCell>
      <TableCell className={cn(cellClass, "text-right tabular-nums", indent && "text-muted-foreground")}>{countFormatter.format(orders)}</TableCell>
      <Amount value={amount} main={main} sub={sub} strong={strong} className={cn(negative && signedTextClass(-1), indent && "text-muted-foreground")} />
    </TableRow>
  );
}
