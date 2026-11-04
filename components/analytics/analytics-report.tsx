"use client"

import type { ReactNode, Ref } from "react"
import { Ban, Banknote, ClipboardList, Hourglass, Percent, Receipt, RotateCcw, Truck, WalletCards } from "lucide-react"
import {
  CostBreakdownChart,
  DailyFlowChart,
  RankedBarsChart,
  ShareRingChart,
} from "@/components/charts/report-charts"
import { cellClass, ReportFooter, ReportHeader, ReportSection, signedTextClass, StatCard, TableFrame, tableHeaderClass } from "@/components/report-ui"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/chart-format"
import type { PosDataset } from "@/lib/pancake/dataset"
import type { MetaAdsSummary } from "@/lib/pancake/types"
import { computeKpi, productRows, sourceRows, weekdayRows } from "@/lib/pancake/kpi"
import { groupRows, STATUS_GROUPS, statusBridge, statusRows, type GroupRow, type StatusGroup } from "@/lib/pancake/status"
import { rangeLabel } from "@/lib/pancake/dates"
import { cn } from "@/lib/utils"

const dash = "—"

function moneyFormatter(currency: string) {
  // pesos read best with a peso locale; everything else follows the Vietnamese convention
  const locale = currency === "PHP" ? "en-PH" : "vi-VN"
  return (value: number) => formatCurrency(value, { locale, currency, maximumFractionDigits: currency === "PHP" ? 2 : 0 })
}

const percentText = (value: number | null, digits = 1) =>
  value === null ? dash : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(value)}%`
const numberText = (value: number | null, digits = 2) =>
  value === null ? dash : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(value)

export function AnalyticsReport({ dataset, metaAds, reportRef }: { dataset: PosDataset; metaAds?: MetaAdsSummary; reportRef?: Ref<HTMLDivElement> }) {
  const currency = dataset.shop.currency.toUpperCase() === "PHP" ? "PHP" : "VND"
  const money = moneyFormatter(currency)
  const kpi = computeKpi(dataset.totals)
  const products = productRows(dataset)
  const sources = sourceRows(dataset)
  const statuses = statusRows(dataset)
  const bridge = statusBridge(dataset)
  const groups = groupRows(statuses)
  const groupOf = (id: StatusGroup) => groups.find((row) => row.group === id)
  const weekdays = weekdayRows(dataset)
  const staff = dataset.staff.filter((entry) => entry.facts.created.totalOrderCount > 0 || entry.facts.net.revenue !== 0)
  const period = rangeLabel(dataset.range.from, dataset.range.to)
  const { totals } = dataset
  const hasAds = kpi.ads > 0
  // Ad spend of the Meta accounts labelled for this shop (read in dong, so only for a dong shop): the real ROAS of the shop
  const metaSpend = currency === "VND" && metaAds ? metaAds.totalSpend : 0

  return (
    <div ref={reportRef} className="report-capture min-w-[1120px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow="Operations Analytics"
        title="Báo cáo phân tích vận hành"
        subtitle={`${dataset.shop.name} · Trạng thái đơn, hoàn, chốt đơn, quảng cáo, COD và cơ cấu bán hàng · ${currency}`}
        metaLabel="Kỳ báo cáo"
        metaValue={period}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Chỉ số chính" description="Doanh thu thực tế = đơn chốt trừ đơn hoàn trong kỳ">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Doanh thu thực tế" value={money(kpi.netRevenue)} helper={`${numberText(kpi.netOrders, 0)} đơn (chốt − hoàn)`} icon={<Banknote />} />
            <StatCard
              label="Lợi nhuận (theo POS)"
              value={money(kpi.netProfit)}
              helper="Chốt − hoàn; trước lương, định phí"
              tone={kpi.netProfit < 0 ? "negative" : "positive"}
              icon={<WalletCards />}
            />
            <StatCard label="Biên lợi nhuận" value={percentText(kpi.margin)} helper="Lợi nhuận / doanh thu thực tế" icon={<Percent />} />
            <StatCard
              label="Giá trị đơn trung bình"
              value={kpi.averageOrderValue === null ? dash : money(kpi.averageOrderValue)}
              helper={`Sau hoàn: ${kpi.netAverageOrderValue === null ? dash : money(kpi.netAverageOrderValue)}`}
              icon={<Receipt />}
            />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <StatCard
              label="Tỷ lệ hoàn (doanh thu)"
              value={percentText(kpi.returnRevenueRate)}
              helper={`Theo đơn: ${percentText(kpi.returnOrderRate)}`}
              tone={kpi.returnRevenueRate !== null && kpi.returnRevenueRate > 15 ? "negative" : "default"}
              icon={<RotateCcw />}
            />
            <StatCard
              label="Tỷ lệ chốt đơn"
              value={percentText(kpi.confirmRate)}
              helper={`${numberText(kpi.unconfirmedOrders, 0)} đơn chưa chốt · sau hoàn ${percentText(kpi.netConversion)}`}
            />
            <StatCard
              label="ROAS"
              value={metaSpend > 0 ? numberText(kpi.netRevenue / metaSpend, 2) : hasAds ? numberText(kpi.roas, 2) : dash}
              helper={
                metaSpend > 0
                  ? `Ads Meta ${money(metaSpend)} · ${percentText(kpi.netRevenue > 0 ? (metaSpend / kpi.netRevenue) * 100 : null)} doanh thu · ${kpi.netOrders > 0 ? money(metaSpend / kpi.netOrders) : dash}/đơn`
                  : hasAds
                    ? `Ads ${money(kpi.ads)} · ${percentText(kpi.adsShare)} doanh thu`
                    : "Chưa có chi phí ads (POS hoặc Ads Meta gắn nhãn)"
              }
            />
            <StatCard
              label="COD còn phải thu"
              value={money(kpi.outstandingCod)}
              helper={`Thanh toán trước ${percentText(kpi.prepaidShare, 0)} · phí VC shop trả ${money(kpi.shippingPaid)}`}
              icon={<Truck />}
            />
          </div>
        </ReportSection>

        <section className="space-y-5">
          <DailyFlowChart
            title="Doanh thu chốt và hoàn theo ngày"
            days={dataset.days.map((day) => ({ date: day.date, moneyIn: day.facts.confirmed.revenue, moneyOut: day.facts.returned.revenue }))}
            currency={currency}
            moneyInLabel="Doanh thu chốt"
            netLabel="Sau hoàn"
            totalLabel="Tổng doanh thu sau hoàn"
          />
          <DailyFlowChart
            title="Lợi nhuận gộp theo ngày"
            days={dataset.days.map((day) => ({
              date: day.date,
              moneyIn: day.facts.net.revenue,
              moneyOut: day.facts.net.revenue - day.facts.net.profit,
            }))}
            currency={currency}
            moneyInLabel="Doanh thu thực tế"
            netLabel="Lợi nhuận"
            totalLabel="Tổng lợi nhuận"
          />
          <div className="grid grid-cols-2 items-start gap-5">
            <ShareRingChart
              title="Cơ cấu doanh thu theo sản phẩm"
              description="Doanh thu thực tế của từng sản phẩm"
              items={products.map((product) => ({ key: product.name, label: product.name, value: product.revenue }))}
              currency={currency}
              shareLabel="tổng doanh thu"
            />
            <RankedBarsChart
              title="Doanh thu theo nhân sự"
              totalLabel="Tổng doanh thu thực tế"
              items={staff.map((entry) => ({ id: entry.id ?? "none", label: entry.name, amount: entry.facts.net.revenue }))}
              currency={currency}
              targetLabel="Trung bình mỗi nhân sự"
            />
          </div>
          <CostBreakdownChart
            title="Chi phí bán hàng theo POS"
            totalLabel="Tổng giá vốn, vận chuyển và ads"
            currency={currency}
            categories={[
              { id: "cogs", label: "Giá vốn" },
              { id: "shipping", label: "Vận chuyển (shop trả)" },
              { id: "ads", label: "Quảng cáo" },
            ]}
            periods={[
              {
                value: "all",
                label: "Cả kỳ",
                values: { cogs: Math.max(0, totals.net.capital), shipping: Math.max(0, totals.created.partnerFee), ads: Math.max(0, totals.created.adsAmount) },
              },
            ]}
          />
        </section>

        <ReportSection
          index="02"
          title="Trạng thái đơn"
          description="Đơn tạo trong kỳ theo trạng thái hiện tại; số đơn và tiền khớp bộ lọc ngày tạo trên POS"
        >
          {bridge ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <StatCard
                  label="Đơn trên POS"
                  value={numberText(bridge.pos.orders, 0)}
                  helper={`${money(bridge.pos.amount)} · mọi trạng thái, trừ đơn xoá`}
                  icon={<ClipboardList />}
                />
                <StatCard
                  label="Đơn huỷ"
                  value={numberText(bridge.canceled.orders, 0)}
                  helper={`${percentText(bridge.canceledRate)} số đơn · ${money(bridge.canceled.amount)} không tính doanh thu`}
                  tone={bridge.canceled.orders > 0 ? "negative" : "default"}
                  icon={<Ban />}
                />
                <GroupCard row={groupOf("waiting")} label="Chờ xử lý / chờ giao" money={money} icon={<Hourglass />} />
                <GroupCard row={groupOf("returned")} label="Hoàn" money={money} icon={<RotateCcw />} />
              </div>

              <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
                <TableFrame>
                  <Table className="text-xs">
                    <TableHeader className={tableHeaderClass}>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Từ số trên POS đến doanh thu</TableHead>
                        <TableHead className="text-right">Số đơn</TableHead>
                        <TableHead className="text-right">Giá trị</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <BridgeRow label="Tổng đơn trên POS (mọi trạng thái)" orders={bridge.pos.orders} amount={bridge.pos.amount} money={money} />
                      <BridgeRow label="− Đơn huỷ" orders={-bridge.canceled.orders} amount={-bridge.canceled.amount} money={money} negative />
                      {Math.abs(bridge.returnedAdjustment) >= 1 ? (
                        <BridgeRow label="± Đơn Pancake tính lại giá trị (đơn hoàn...)" amount={-bridge.returnedAdjustment} money={money} negative />
                      ) : null}
                      <BridgeRow label="= Doanh thu đơn tạo trong kỳ" orders={bridge.remaining.orders} amount={bridge.remaining.counted} money={money} strong />
                      {Math.abs(bridge.returnsByDate) >= 1 ? (
                        <BridgeRow label="± Hoàn ghi theo ngày hoàn" amount={bridge.returnsByDate} money={money} negative />
                      ) : null}
                      <BridgeRow label="= Doanh thu thực tế" amount={bridge.revenue} money={money} strong />
                    </TableBody>
                  </Table>
                  {Math.abs(bridge.gap) >= 1 ? (
                    <p className="border-t px-4 py-2 text-xs text-amber-700">
                      Lệch {money(Math.abs(bridge.gap))} giữa tổng theo trạng thái và doanh thu theo ngày; cần kiểm tra lại với POS.
                    </p>
                  ) : null}
                </TableFrame>
                <ShareRingChart
                  title="Giá trị đơn theo nhóm trạng thái"
                  description="Theo số trên POS, gồm cả đơn huỷ để thấy phần bị mất"
                  items={groups.filter((row) => row.amount > 0).map((row) => ({ key: row.group, label: row.label, value: row.amount }))}
                  currency={currency}
                  shareLabel="tổng giá trị đơn"
                />
              </div>

              <TableFrame>
                <Table className="text-xs">
                  <TableHeader className={tableHeaderClass}>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Nhóm</TableHead>
                      <TableHead className="text-right">Số đơn</TableHead>
                      <TableHead className="text-right">% đơn</TableHead>
                      <TableHead className="text-right">Giá trị trên POS</TableHead>
                      <TableHead className="text-right">% giá trị</TableHead>
                      <TableHead className="text-right">Trả trước</TableHead>
                      <TableHead className="text-right">COD</TableHead>
                      <TableHead className="text-right">Tính vào doanh thu</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statuses.map((row) => {
                      const removed = row.status === "7"
                      return (
                        <TableRow key={row.status} className={cn(!row.countsAsRevenue && "text-muted-foreground")}>
                          <TableCell className={cn(cellClass, "font-medium")}>
                            {row.label} <span className="font-normal text-muted-foreground">· mã {row.status}</span>
                          </TableCell>
                          <TableCell className={cn(cellClass, "text-muted-foreground")}>{STATUS_GROUPS.find((group) => group.id === row.group)?.label}</TableCell>
                          <TableCell className={cn(cellClass, "text-right tabular-nums")}>{numberText(row.orders, 0)}</TableCell>
                          <TableCell className={cn(cellClass, "text-right tabular-nums")}>
                            {removed ? dash : percentText(bridge.pos.orders > 0 ? (row.orders / bridge.pos.orders) * 100 : null)}
                          </TableCell>
                          <TableCell className={cn(cellClass, "text-right tabular-nums")}>{money(row.amount)}</TableCell>
                          <TableCell className={cn(cellClass, "text-right tabular-nums")}>
                            {removed ? dash : percentText(bridge.pos.amount > 0 ? (row.amount / bridge.pos.amount) * 100 : null)}
                          </TableCell>
                          <TableCell className={cn(cellClass, "text-right tabular-nums")}>{money(row.prepaid)}</TableCell>
                          <TableCell className={cn(cellClass, "text-right tabular-nums")}>{money(row.cod)}</TableCell>
                          <TableCell className={cn(cellClass, "text-right tabular-nums")}>{row.countsAsRevenue ? money(row.counted) : "Không"}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableFrame>
              <p className="text-xs text-muted-foreground">
                Số đơn và “Giá trị trên POS” (COD + trả trước) lấy từ danh sách đơn nên khớp thanh tổng của POS. “Tính vào doanh thu” là phần Pancake đưa vào doanh thu: đơn hoàn được Pancake tính lại (về 0 hoặc âm) nên có thể thấp hơn số trên POS.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Báo cáo đã lưu này chưa có dữ liệu theo trạng thái đơn. Bấm “Lấy dữ liệu” để lấy lại.
            </p>
          )}
        </ReportSection>

        <ReportSection index="03" title="Nguồn đơn" description="Doanh thu thực tế theo nguồn đơn trên POS (Zalo, Facebook, sàn...)">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Nguồn đơn</TableHead>
                  <TableHead className="text-right">Doanh thu thực tế</TableHead>
                  <TableHead className="text-right">Lợi nhuận</TableHead>
                  <TableHead className="text-right">Biên LN</TableHead>
                  <TableHead className="text-right">Tỷ trọng</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.name}>
                    <TableCell className={cn(cellClass, "font-medium")}>{source.name}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums")}>{money(source.revenue)}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums", signedTextClass(source.profit))}>{money(source.profit)}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums", source.margin !== null && signedTextClass(source.margin))}>{percentText(source.margin)}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>
                      {percentText(totals.net.revenue > 0 ? (source.revenue / totals.net.revenue) * 100 : null)}
                    </TableCell>
                  </TableRow>
                ))}
                {!sources.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      Chưa có dữ liệu nguồn đơn trong kỳ.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="04" title="Sản phẩm" description="Doanh thu thực tế và biên lợi nhuận; biên âm nghĩa là đang bán lỗ">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead className="text-right">Doanh thu thực tế</TableHead>
                  <TableHead className="text-right">Lợi nhuận</TableHead>
                  <TableHead className="text-right">Biên LN</TableHead>
                  <TableHead className="text-right">Tỷ trọng</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.slice(0, 10).map((product) => (
                  <TableRow key={product.name}>
                    <TableCell className={cn(cellClass, "font-medium")}>{product.name}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums")}>{money(product.revenue)}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums", signedTextClass(product.profit))}>{money(product.profit)}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums", product.margin !== null && signedTextClass(product.margin))}>{percentText(product.margin)}</TableCell>
                    <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>
                      {percentText(totals.net.revenue > 0 ? (product.revenue / totals.net.revenue) * 100 : null)}
                    </TableCell>
                  </TableRow>
                ))}
                {!products.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      Chưa có dữ liệu sản phẩm trong kỳ.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="05" title="Phễu chốt đơn theo nhân sự" description="Đơn tạo → đơn chốt → đơn hoàn; tỷ lệ chốt tính trên đơn tạo trong kỳ">
          <TableFrame>
            <Table className="text-xs">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Nhân sự</TableHead>
                  <TableHead className="text-right">Đơn tạo</TableHead>
                  <TableHead className="text-right">Đơn chốt</TableHead>
                  <TableHead className="text-right">Đơn hoàn</TableHead>
                  <TableHead className="text-right">Tỷ lệ chốt</TableHead>
                  <TableHead className="text-right">Tỷ lệ hoàn</TableHead>
                  <TableHead className="text-right">Doanh thu thực tế</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((entry) => {
                  const kpiRow = computeKpi(entry.facts)
                  return (
                    <TableRow key={entry.id ?? "none"}>
                      <TableCell className={cn(cellClass, "font-medium")}>{entry.name}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{numberText(entry.facts.created.totalOrderCount, 0)}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{numberText(entry.facts.confirmed.orderCount, 0)}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{numberText(entry.facts.returned.orderCount, 0)}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{percentText(kpiRow.confirmRate)}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{percentText(kpiRow.returnOrderRate)}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums font-medium")}>{money(entry.facts.net.revenue)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableFrame>
        </ReportSection>

        {weekdays.length >= 2 ? (
          <ReportSection index="06" title="Theo thứ trong tuần" description="Doanh thu tạo trung bình mỗi ngày và tỷ lệ hoàn, theo từng thứ">
            <TableFrame>
              <Table className="text-xs">
                <TableHeader className={tableHeaderClass}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Thứ</TableHead>
                    <TableHead className="text-right">Số ngày</TableHead>
                    <TableHead className="text-right">Doanh thu tạo TB / ngày</TableHead>
                    <TableHead className="text-right">Tỷ lệ hoàn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weekdays.map((row) => (
                    <TableRow key={row.weekday}>
                      <TableCell className={cn(cellClass, "font-medium")}>{row.label}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums text-muted-foreground")}>{row.days}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{money(row.averageRevenue)}</TableCell>
                      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{percentText(row.returnRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          </ReportSection>
        ) : null}

        <ReportFooter
          left="Số liệu từ Pancake POS; tỷ lệ chốt/hoàn có thể lệch khi kỳ ngắn vì đơn chốt hoặc hoàn của kỳ trước vẫn được tính"
          right={`Đơn vị tiền tệ: ${currency === "PHP" ? "Peso (PHP)" : "Việt Nam Đồng (VND)"}`}
        />
      </div>
    </div>
  )
}

function GroupCard({ row, label, money, icon }: { row: GroupRow | undefined; label: string; money: (value: number) => string; icon: ReactNode }) {
  return <StatCard label={label} value={numberText(row?.orders ?? 0, 0)} helper={row ? `${money(row.amount)} · ${row.hint}` : "Không có đơn"} icon={icon} />
}

function BridgeRow({
  label,
  orders,
  amount,
  money,
  strong = false,
  negative = false,
}: {
  label: string
  orders?: number
  amount: number
  money: (value: number) => string
  strong?: boolean
  negative?: boolean
}) {
  return (
    <TableRow className={cn(strong && "bg-muted/40")}>
      <TableCell className={cn(cellClass, strong ? "font-medium" : "text-muted-foreground")}>{label}</TableCell>
      <TableCell className={cn(cellClass, "text-right tabular-nums")}>{orders === undefined ? dash : numberText(orders, 0)}</TableCell>
      <TableCell className={cn(cellClass, "text-right tabular-nums", strong && "font-semibold", negative && signedTextClass(amount))}>{money(amount)}</TableCell>
    </TableRow>
  )
}
