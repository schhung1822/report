import type { Ref } from "react";
import { Banknote, Megaphone, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { ReportFooter, ReportHeader, StatCard } from "@/components/report-ui";
import type { SheetMarket } from "@/lib/costs/daily-sheet";
import { toDmy } from "@/lib/pancake/dates";
import type { PnlComputed, PnlRow, PnlStyle } from "@/lib/pnl/sheet";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** A coloured rule above each heading groups the columns like the accountant's Excel: sales, costs, profits. */
const GROUP_RULE: Record<PnlStyle, string> = {
  revenue: "border-t-emerald-500",
  major: "border-t-amber-400",
  line: "border-t-amber-200",
  detail: "border-t-amber-100",
  ratio: "border-t-amber-200",
  result: "border-t-sky-500",
};

const strong = (row: PnlRow) => row.style === "revenue" || row.style === "major" || row.style === "result";

/** The line a channel column belongs to ("Chi phí cố định" for its Zalo column). */
export function parentLabel(rows: PnlRow[], row: PnlRow) {
  return rows.find((candidate) => candidate.sum?.includes(row.id))?.label ?? "";
}

/**
 * The profit sheet as a report to read, print and send: header, the month's key figures and one row per day with the
 * columns chosen. It shows exactly what the sheet computed (typed costs included), with no inputs, so the picture is clean.
 */
export function PnlReport({
  reportRef,
  market,
  shopName,
  from,
  to,
  rows,
  columns,
  days,
  computed,
  fetchedAt,
  missing,
}: {
  reportRef: Ref<HTMLDivElement>;
  market: SheetMarket;
  shopName: string;
  from: string;
  to: string;
  rows: PnlRow[];
  /** The rows shown as columns, in order. */
  columns: PnlRow[];
  days: string[];
  computed: PnlComputed;
  /** When the POS figures were read (oldest first), for the footer. */
  fetchedAt: string[];
  /** Notes on what is still missing (e.g. cost of goods not typed for some days). */
  missing: string[];
}) {
  const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
  const unit = market === "PHP" ? "₱" : "₫";
  const total = (id: string) => computed.total.get(id) ?? 0;
  const revenue = total("1");
  const percent = (part: number) => (revenue ? `${((part / revenue) * 100).toFixed(1)}%` : "—");
  const amount = (value: number) => `${money.format(value)} ${unit}`;
  const format = (row: PnlRow, value: number) => (row.ratio ? `${value.toFixed(1)}%` : money.format(value));
  const sellingDays = (computed.byDay.get("1") ?? []).filter((value) => value > 0).length;
  const salesCost = total("8") + (market === "PHP" ? total("9") : 0);
  const profit = total("10");
  const fetched = fetchedAt.length
    ? new Date(fetchedAt[0]).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  return (
    // mx-auto centres the report in the viewport; a report wider than the viewport still scrolls from its left edge.
    <div ref={reportRef} className="report-capture mx-auto w-max min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow={`Báo cáo quản trị lợi nhuận · ${market === "PHP" ? "Philippines" : "Việt Nam"}`}
        title="Kết quả kinh doanh theo ngày"
        subtitle={`${shopName} · Doanh số, chi phí và lợi nhuận từng ngày · ${market === "PHP" ? "PHP" : "VND"}`}
        metaLabel="Kỳ báo cáo"
        metaValue={from === to ? toDmy(from) : `${toDmy(from)} – ${toDmy(to)}`}
      />

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="Doanh số" value={amount(revenue)} helper={`${sellingDays} ngày có doanh số`} icon={<Banknote />} />
          <StatCard label="Lợi nhuận gộp" value={amount(total("5"))} helper={`Biên gộp ${percent(total("5"))}`} tone={total("5") < 0 ? "negative" : "default"} />
          <StatCard label="Chi phí ADS" value={amount(total("8.1"))} helper={`Tỷ lệ ADS / doanh số ${percent(total("8.1"))}`} icon={<Megaphone />} />
          <StatCard label={market === "PHP" ? "Chi phí bán hàng & quản lý" : "Chi phí bán hàng"} value={amount(salesCost)} helper={`${percent(salesCost)} doanh số`} icon={<Wallet />} />
          <StatCard
            label="Lợi nhuận thuần"
            value={amount(profit)}
            helper={`Biên lợi nhuận ${percent(profit)}`}
            icon={profit < 0 ? <TrendingDown /> : <TrendingUp />}
            tone={profit < 0 ? "negative" : "positive"}
          />
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-[11px] tabular-nums">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="w-20 border-b px-3 py-2 text-left align-bottom font-medium">Ngày</th>
                {columns.map((row) => (
                  <th
                    key={row.id}
                    title={row.label}
                    className={cn("border-b border-t-[3px] px-2.5 py-2 text-right align-bottom font-medium leading-tight", GROUP_RULE[row.style], strong(row) && "text-foreground")}
                  >
                    {row.style === "detail" && row.input?.channel ? <span className="block text-[10px] font-normal">{parentLabel(rows, row)}</span> : null}
                    {row.style === "detail" && row.input?.channel ? row.label.replace("Kênh ", "") : (row.short ?? row.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((date, index) => {
                const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
                return (
                  <tr key={date} className={cn("border-b last:border-b-0", index % 2 === 1 && "bg-muted/25")}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium">
                      {toDmy(date).slice(0, 5)} <span className={cn("text-[10px] font-normal", weekday === 0 ? "text-destructive" : "text-muted-foreground")}>{WEEKDAYS[weekday]}</span>
                    </td>
                    {columns.map((row) => {
                      const value = computed.byDay.get(row.id)?.[index] ?? 0;
                      return (
                        <td
                          key={row.id}
                          className={cn(
                            "whitespace-nowrap px-2.5 py-1.5 text-right",
                            strong(row) && "font-medium",
                            row.style === "result" && (value < 0 ? "text-destructive" : value > 0 && "text-emerald-700"),
                            value === 0 && "text-muted-foreground/40",
                          )}
                        >
                          {value === 0 && !row.ratio ? "–" : format(row, value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-foreground/20 bg-muted/60 font-semibold">
                <td className="px-3 py-2">Tổng</td>
                {columns.map((row) => {
                  const value = total(row.id);
                  return (
                    <td key={row.id} className={cn("whitespace-nowrap px-2.5 py-2 text-right", row.style === "result" && (value < 0 ? "text-destructive" : "text-emerald-700"))}>
                      {format(row, value)}
                    </td>
                  );
                })}
              </tr>
              <tr className="bg-muted/30 text-muted-foreground">
                <td className="px-3 py-1.5">% doanh số</td>
                {columns.map((row) => (
                  <td key={row.id} className="px-2.5 py-1.5 text-right">
                    {row.ratio ? "" : percent(total(row.id))}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        {missing.length ? (
          <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
            {missing.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <ReportFooter
          left={`Nguồn: Pancake POS, Ads Meta, lương nhân sự và chi phí nhập tay${fetched ? ` · số POS lấy lúc ${fetched}` : ""}`}
          right={`Đơn vị tiền tệ: ${market === "PHP" ? "Peso Philippines (₱)" : "Việt Nam Đồng (₫)"}`}
        />
      </div>
    </div>
  );
}
