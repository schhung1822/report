"use client"

import type { Ref } from "react"
import { Banknote, CircleDollarSign, Eye, MessageCircle, MousePointerClick, Percent, ShoppingBag, Target } from "lucide-react"
import { DailyFlowChart, RankedBarsChart, ShareRingChart } from "@/components/charts/report-charts"
import { cellClass, ReportFooter, ReportHeader, ReportSection, StatCard, TableFrame, tableHeaderClass } from "@/components/report-ui"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/chart-format"
import type { AdsMetrics, AdsReport } from "@/lib/ads/types"
import { rangeLabel, toDmy } from "@/lib/pancake/dates"
import { cn } from "@/lib/utils"

const dash = "—"
/** The campaign table lists this many; the report holds more, but a longer table only hides the biggest spenders. */
const TABLE_CAMPAIGNS = 15

const numberText = (value: number | null, digits = 0) =>
  value === null ? dash : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(value)
const percentText = (value: number | null) => (value === null ? dash : `${numberText(value, 2)}%`)
const roasText = (value: number | null) => (value === null ? dash : `${numberText(value, 2)}x`)

/** ROAS above 1 earns more than it spends, below 1 loses on the ads alone; green or red tells which. */
const roasTone = (value: number | null) => (value === null ? undefined : value >= 1 ? "text-emerald-600" : "text-destructive")

export function AdsReportView({ report, reportRef }: { report: AdsReport; reportRef?: Ref<HTMLDivElement> }) {
  const { currency, totals, accounts, days, campaigns } = report
  const money = (value: number | null) => (value === null ? dash : formatCurrency(value, { locale: "vi-VN", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }))
  const period = rangeLabel(report.range.from, report.range.to)
  const spending = accounts.filter((entry) => entry.metrics.spend > 0)
  const idle = accounts.length - spending.length
  const shownCampaigns = campaigns.slice(0, TABLE_CAMPAIGNS)
  const margin = totals.conversionValue - totals.spend

  return (
    <div ref={reportRef} className="report-capture min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Meta Ads Performance"
        title="Báo cáo quảng cáo Meta"
        subtitle={`${spending.length} tài khoản có chi tiêu / ${accounts.length} được chọn · Tiền tệ ${currency}`}
        metaLabel="Kỳ báo cáo"
        metaValue={period}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Chỉ số chính" description="Số liệu từ Meta Ads Manager qua Ads MCP; ngày theo múi giờ của tài khoản">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Chi tiêu quảng cáo" value={money(totals.spend)} helper={`Trung bình ${money(report.range.dayCount ? totals.spend / report.range.dayCount : 0)}/ngày`} icon={<Banknote />} />
            <StatCard
              label="Giá trị chuyển đổi"
              value={money(totals.conversionValue)}
              helper={`${margin >= 0 ? "Hơn" : "Thấp hơn"} chi tiêu ${money(Math.abs(margin))}`}
              icon={<CircleDollarSign />}
              tone={totals.spend > 0 ? (margin >= 0 ? "positive" : "negative") : "default"}
            />
            <StatCard label="ROAS" value={roasText(totals.roas)} helper="Giá trị chuyển đổi / chi tiêu" icon={<Target />} tone={totals.roas === null ? "default" : totals.roas >= 1 ? "positive" : "negative"} />
            <StatCard label="Đơn mua (theo Meta)" value={numberText(totals.purchases)} helper={`Chi phí / đơn ${money(totals.costPerPurchase)}`} icon={<ShoppingBag />} />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <StatCard label="Hiển thị" value={numberText(totals.impressions)} helper={`CPM ${money(totals.cpm)}`} icon={<Eye />} />
            <StatCard label="Lượt click" value={numberText(totals.clicks)} helper={`CTR ${percentText(totals.ctr)} · CPC ${money(totals.cpc)}`} icon={<MousePointerClick />} />
            <StatCard label="Tin nhắn mới" value={numberText(totals.messages)} helper={`Chi phí / tin nhắn ${money(totals.costPerMessage)}`} icon={<MessageCircle />} />
            <StatCard label="Chuyển đổi" value={numberText(totals.conversions)} helper={`CPA ${money(totals.cpa)} · ${numberText(totals.leads)} lead`} icon={<Percent />} />
          </div>
        </ReportSection>

        <section className="space-y-4">
          <DailyFlowChart
            title="Giá trị chuyển đổi và chi tiêu theo ngày"
            days={days.map((day) => ({ date: day.date, moneyIn: day.metrics.conversionValue, moneyOut: day.metrics.spend }))}
            currency={currency}
            moneyInLabel="Giá trị chuyển đổi"
            netLabel="Sau chi phí Ads"
            totalLabel="Giá trị chuyển đổi trừ chi tiêu"
          />
          <div className="grid grid-cols-2 items-stretch gap-4">
            <ShareRingChart
              title="Cơ cấu chi tiêu theo tài khoản"
              description="Tỷ trọng chi tiêu của từng tài khoản"
              items={spending.map((entry) => ({ key: entry.account.id, label: entry.account.name, value: entry.metrics.spend }))}
              currency={currency}
              shareLabel="tổng chi tiêu"
            />
            <RankedBarsChart
              title="Chiến dịch chi nhiều nhất"
              totalLabel="Chi tiêu của các chiến dịch này"
              items={campaigns.slice(0, 6).map((entry) => ({ id: `${entry.accountId}-${entry.campaignId}`, label: entry.name.length > 22 ? `${entry.name.slice(0, 21)}…` : entry.name, amount: entry.metrics.spend }))}
              currency={currency}
              targetLabel="Trung bình mỗi chiến dịch"
            />
          </div>
        </section>

        <ReportSection
          index="02"
          title="Theo tài khoản quảng cáo"
          description={`Xếp theo chi tiêu giảm dần${idle ? ` · ${idle} tài khoản không chi tiêu trong kỳ` : ""}`}
        >
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Tài khoản</TableHead>
                  <TableHead className="text-right">Chi tiêu</TableHead>
                  <TableHead className="text-right">Hiển thị</TableHead>
                  <TableHead className="text-right">Click</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">Đơn mua</TableHead>
                  <TableHead className="text-right">Giá trị CĐ</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Tin nhắn</TableHead>
                  <TableHead className="text-right">Giá / tin nhắn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spending.map((entry) => (
                  <TableRow key={entry.account.id} className="break-inside-avoid">
                    <TableCell className={cn(cellClass, "font-medium")}>
                      {entry.account.name}
                      <span className="block text-[11px] font-normal text-muted-foreground">{entry.account.id}</span>
                    </TableCell>
                    <MetricCells metrics={entry.metrics} money={money} />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className={cn(cellClass, "font-semibold")}>Tổng</TableCell>
                  <MetricCells metrics={totals} money={money} strong />
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="03" title="Theo ngày" description="Tổng các tài khoản đã chọn">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ngày</TableHead>
                  <TableHead className="text-right">Chi tiêu</TableHead>
                  <TableHead className="text-right">Hiển thị</TableHead>
                  <TableHead className="text-right">Click</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">Đơn mua</TableHead>
                  <TableHead className="text-right">Giá trị CĐ</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Tin nhắn</TableHead>
                  <TableHead className="text-right">Giá / tin nhắn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((day) => (
                  <TableRow key={day.date} className={cn("break-inside-avoid", day.metrics.spend === 0 && "text-muted-foreground")}>
                    <TableCell className={cn(cellClass, "font-medium")}>{toDmy(day.date)}</TableCell>
                    <MetricCells metrics={day.metrics} money={money} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        </ReportSection>

        {campaigns.length ? (
          <ReportSection
            index="04"
            title="Chiến dịch chi nhiều nhất"
            description={
              report.campaignCount === null
                ? `${shownCampaigns.length} chiến dịch chi nhiều nhất`
                : `${shownCampaigns.length}/${report.campaignCount} chiến dịch có chi tiêu`
            }
          >
            <TableFrame>
              <Table className="text-xs">
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Chiến dịch</TableHead>
                    <TableHead>Tài khoản</TableHead>
                    <TableHead className="text-right">Chi tiêu</TableHead>
                    <TableHead className="text-right">Hiển thị</TableHead>
                    <TableHead className="text-right">Click</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">Đơn mua</TableHead>
                    <TableHead className="text-right">Giá trị CĐ</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                    <TableHead className="text-right">Tin nhắn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownCampaigns.map((entry) => (
                    <TableRow key={`${entry.accountId}-${entry.campaignId}`} className="break-inside-avoid">
                      <TableCell className={cn(cellClass, "max-w-[260px] truncate font-medium")} title={entry.name}>
                        {entry.name}
                      </TableCell>
                      <TableCell className={cn(cellClass, "max-w-[160px] truncate text-muted-foreground")}>{entry.accountName}</TableCell>
                      <NumberCell>{money(entry.metrics.spend)}</NumberCell>
                      <NumberCell>{numberText(entry.metrics.impressions)}</NumberCell>
                      <NumberCell>{numberText(entry.metrics.clicks)}</NumberCell>
                      <NumberCell>{percentText(entry.metrics.ctr)}</NumberCell>
                      <NumberCell>{numberText(entry.metrics.purchases)}</NumberCell>
                      <NumberCell>{money(entry.metrics.conversionValue)}</NumberCell>
                      <NumberCell className={cn("font-medium", roasTone(entry.metrics.roas))}>{roasText(entry.metrics.roas)}</NumberCell>
                      <NumberCell>{numberText(entry.metrics.messages)}</NumberCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          </ReportSection>
        ) : null}

        <ReportFooter
          left={`Nguồn: Meta Ads qua Ads MCP · lấy lúc ${new Date(report.fetchedAt).toLocaleString("vi-VN")}`}
          right={`Đơn vị tiền tệ: ${currency}`}
        />
      </div>
    </div>
  )
}

function NumberCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <TableCell className={cn(cellClass, "text-right tabular-nums", className)}>{children}</TableCell>
}

/** The figure cells shared by the account, day and total rows. */
function MetricCells({ metrics, money, strong = false }: { metrics: AdsMetrics; money: (value: number | null) => string; strong?: boolean }) {
  const weight = strong ? "font-semibold" : undefined
  return (
    <>
      <NumberCell className={weight}>{money(metrics.spend)}</NumberCell>
      <NumberCell className={weight}>{numberText(metrics.impressions)}</NumberCell>
      <NumberCell className={weight}>{numberText(metrics.clicks)}</NumberCell>
      <NumberCell className={weight}>{percentText(metrics.ctr)}</NumberCell>
      <NumberCell className={weight}>{money(metrics.cpc)}</NumberCell>
      <NumberCell className={weight}>{numberText(metrics.purchases)}</NumberCell>
      <NumberCell className={weight}>{money(metrics.conversionValue)}</NumberCell>
      <NumberCell className={cn(weight ?? "font-medium", roasTone(metrics.roas))}>{roasText(metrics.roas)}</NumberCell>
      <NumberCell className={weight}>{numberText(metrics.messages)}</NumberCell>
      <NumberCell className={weight}>{money(metrics.costPerMessage)}</NumberCell>
    </>
  )
}
