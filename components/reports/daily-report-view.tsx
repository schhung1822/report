import type { Ref } from "react";
import {
  cellClass,
  ReportFooter,
  ReportHeader,
  ReportSection,
  signedTextClass,
  StatCard,
  TableFrame,
  tableHeaderClass,
} from "@/components/report-ui";
import { DailyReportCharts } from "@/components/charts/report-chart-blocks";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deriveDaily, formatDailyMoney as formatMoney, type DailyReportData } from "@/lib/daily-report";

export function DailyReportView({
  data,
  companyName,
  reportRef,
}: {
  data: DailyReportData;
  companyName: string;
  reportRef?: Ref<HTMLDivElement>;
}) {
  const calculations = deriveDaily(data);
  const { expenseGroups } = calculations;

  return (
    <div ref={reportRef} className="report-capture min-w-[860px] bg-white text-foreground shadow-sm">
      <ReportHeader
        eyebrow={companyName || "Đơn vị báo cáo"}
        title="Báo cáo tài chính hàng ngày"
        subtitle="Tổng hợp doanh thu, chi phí và cân đối dòng tiền"
        metaLabel="Ngày báo cáo"
        metaValue={data.reportDate || "—"}
      />

      <div className="space-y-8 p-10">
        <ReportSection index="01" title="Tổng hợp doanh thu" description="Đối soát doanh số và các khoản phải thu trong ngày">
          <TableFrame>
            <Table>
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[60%]">Chỉ tiêu</TableHead>
                  <TableHead className="text-right">Giá trị</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <MetricRow label="Doanh số trong ngày" value={data.revenue} strong />
                <MetricRow label="Nhận tiền chuyển khoản" value={data.bankTransfer} />
                <MetricRow label="Tiền phải thu khách (COD)" value={data.codReceivable} />
                <MetricRow label="Phí trả đơn vị vận chuyển" value={data.shippingFee} />
              </TableBody>
            </Table>
          </TableFrame>
        </ReportSection>

        <DailyReportCharts data={data} />

        <ReportSection index="02" title="Bảng kê chi phí xuất quỹ" description="Các khoản chi được gom nhóm theo người thanh toán">
          <TableFrame>
            <Table className="table-fixed">
              <TableHeader className={tableHeaderClass}>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[8%] text-center">STT</TableHead>
                  <TableHead className="w-[20%]">Người chi</TableHead>
                  <TableHead className="w-[44%]">Chi tiết nhà cung cấp</TableHead>
                  <TableHead className="w-[28%] text-right">Tổng nhóm</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenseGroups.length ? (
                  expenseGroups.map((group, groupIndex) => (
                    <TableRow key={`${group.payer}-${groupIndex}`} className="align-top">
                      <TableCell className={`${cellClass} text-center tabular-nums text-muted-foreground`}>
                        {String(groupIndex + 1).padStart(2, "0")}
                      </TableCell>
                      <TableCell className={cellClass}>
                        <Badge variant="secondary">{group.payer}</Badge>
                        <p className="mt-1.5 text-xs text-muted-foreground">{group.items.length} khoản chi</p>
                      </TableCell>
                      <TableCell className="whitespace-normal px-4 py-1.5">
                        <ul className="divide-y">
                          {group.items.map((item, itemIndex) => (
                            <li key={`${item.supplier}-${itemIndex}`} className="flex justify-between gap-4 py-1.5">
                              <span className="min-w-0 truncate">{item.supplier}</span>
                              <span className="tabular-nums text-muted-foreground">{formatMoney(item.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className={`${cellClass} text-right text-base font-semibold tabular-nums`}>
                        {formatMoney(group.total)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      Chưa có khoản chi nhà cung cấp trong ngày.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className={`${cellClass} text-right text-xs text-muted-foreground`}>
                    Tổng chi nhà cung cấp
                  </TableCell>
                  <TableCell className={`${cellClass} text-right text-base font-semibold tabular-nums`}>
                    {formatMoney(calculations.supplierExpenses)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableFrame>
        </ReportSection>

        <ReportSection index="03" title="Tổng kết dòng tiền" description="Thu thực tế, chi thực tế và nghĩa vụ phải thu">
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Tổng thu thực tế" value={formatMoney(calculations.totalIncome)} helper="Nhận tiền chuyển khoản" tone="positive" />
            <StatCard label="Tổng chi thực tế" value={formatMoney(calculations.totalExpense)} helper="Phí vận chuyển + chi NCC" tone="negative" />
          </div>
          <div className="mt-4 divide-y overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between gap-6 px-5 py-4">
              <div>
                <p className="text-sm font-medium">Biến động quỹ tiền mặt</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Tổng thu thực tế − Tổng chi thực tế</p>
              </div>
              <span className={`text-lg font-semibold tabular-nums ${signedTextClass(calculations.cashMovement)}`}>
                {calculations.cashMovement > 0 ? "+" : ""}
                {formatMoney(calculations.cashMovement)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-6 bg-muted/50 px-5 py-5">
              <div>
                <p className="text-base font-semibold">Dự kiến số dư tổng</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Biến động quỹ tiền mặt + Tiền phải thu khách (COD)</p>
              </div>
              <span className="text-2xl font-semibold tabular-nums tracking-tight">{formatMoney(calculations.projectedBalance)}</span>
            </div>
          </div>
        </ReportSection>

        <ReportFooter left="Báo cáo được tạo tự động từ dữ liệu đối soát" right="Đơn vị tiền tệ: Việt Nam Đồng (VND)" />
      </div>
    </div>
  );
}

function MetricRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <TableRow>
      <TableCell className={`${cellClass} ${strong ? "font-medium" : "text-muted-foreground"}`}>{label}</TableCell>
      <TableCell className={`${cellClass} text-right tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{formatMoney(value)}</TableCell>
    </TableRow>
  );
}
