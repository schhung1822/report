// Compact, Vietnamese-keyed views of each report, sent to the AI analysis endpoint.
import { deriveDaily, type DailyReportData } from "@/lib/daily-report";
import {
  summarizePerformance,
  type CumulativePerformanceRow,
  type DailyPerformanceRow,
} from "@/lib/performance-report";
import type { ProcessedMonthlyFinanceReport } from "@/types/finance";
import type { CalculatedChannelMetrics, HiddenStatus, ProcessedManagementReport } from "@/types/financial-management";

export function buildDailyAnalysisData(data: DailyReportData, companyName: string) {
  const calculations = deriveDaily(data);
  return {
    ngayBaoCao: data.reportDate,
    donVi: companyName,
    doanhSoTrongNgay: data.revenue,
    nhanTienChuyenKhoan: data.bankTransfer,
    tienCodPhaiThuKhach: data.codReceivable,
    phiTraDonViVanChuyen: data.shippingFee,
    tongChiNhaCungCap: calculations.supplierExpenses,
    tongThuThucTe: calculations.totalIncome,
    tongChiThucTe: calculations.totalExpense,
    bienDongQuyTienMat: calculations.cashMovement,
    duKienSoDuTong: calculations.projectedBalance,
    chiPhiTheoNguoiChi: calculations.expenseGroups.map((group) => ({
      nguoiChi: group.payer,
      tongNhom: group.total,
      chiTiet: group.items.map((item) => ({ nhaCungCap: item.supplier, soTien: item.amount })),
    })),
  };
}

export function buildPerformanceAnalysisData(
  dailyRows: DailyPerformanceRow[],
  cumulativeRows: CumulativePerformanceRow[],
  reportDate: string,
) {
  const { overview, revenueDistribution } = summarizePerformance(dailyRows);
  return {
    ngayBaoCao: reportDate,
    tongQuan: {
      tongDoanhThu: overview.revenue,
      tongChiPhi: overview.cost,
      loiNhuanGop: overview.grossProfit,
      loiNhuanRong: overview.netProfit,
    },
    coCauDoanhThu: revenueDistribution.map((item) => ({ nhom: item.name, doanhThu: item.value })),
    hieuSuatNhanSuTrongNgay: dailyRows.map((row) => ({
      nhanSu: row.name,
      doanhThu: row.revenue,
      giaVon: row.cogs,
      vanChuyen: row.shipping,
      luong: row.salary,
      chiPhiCoDinh: row.fixedCost,
      ads: row.ads,
      tongChiPhi: row.totalCost,
      loiNhuanGop: row.grossProfit,
      hoanDuTinh: row.estimatedReturn,
      doanhThuSauHoan: row.netRevenue,
      loiNhuanRong: row.netProfit,
    })),
    luyKeThang: cumulativeRows.map((row) => ({
      nhanSu: row.name,
      tongDon: row.totalOrders,
      donThanhCong: row.successOrders,
      tyLeThanhCongPhanTram: row.convRate,
      doanhThuLenDon: row.totalRevenue,
      loiNhuanLenDon: row.totalProfit,
      doanhThuThucNhan: row.receivedRevenue,
      loiNhuanThucNhan: row.receivedProfit,
    })),
  };
}

const HIDDEN_LABEL: Record<HiddenStatus, string> = { profit: "Lãi ngầm", loss: "Lỗ ngầm", balanced: "Cân bằng" };

function channelSnapshot(metrics: CalculatedChannelMetrics) {
  return {
    doanhThu: metrics.revenue,
    tongGiaVon: metrics.totalCogs,
    tongLuong: metrics.totalSalary,
    chiPhiMarketing: metrics.adsCost,
    tongDinhPhi: metrics.totalFixedCosts,
    loiNhuan: metrics.profit,
  };
}

/** The Vietnam (CSKH Zalo) management report: only the Zalo channel is described. */
export function buildVnManagementAnalysisData(report: ProcessedManagementReport) {
  const { summary } = report;
  return {
    kyBaoCao: summary.dateRangeLabel,
    kenh: "Nhóm CSKH Zalo (Việt Nam, VND)",
    tongKy: {
      duTinh: channelSnapshot(summary.estimated.zalo),
      thucTe: channelSnapshot(summary.actual.zalo),
      chenhLechDoanhThu: summary.actual.zalo.revenue - summary.estimated.zalo.revenue,
      chenhLechLoiNhuan: summary.actual.zalo.profit - summary.estimated.zalo.profit,
    },
    topSanPhamDoanhThu: summary.actual.zalo.topRevenueProducts.slice(0, 5),
    topSanPhamLoiNhuan: summary.actual.zalo.topProfitProducts.slice(0, 5),
    theoNgay: report.days.map((day) => {
      const revenueDiff = day.actual.zalo.revenue - day.estimated.zalo.revenue;
      const profitDiff = day.actual.zalo.profit - day.estimated.zalo.profit;
      return {
        ngay: day.dateLabel,
        duTinh: channelSnapshot(day.estimated.zalo),
        thucTe: channelSnapshot(day.actual.zalo),
        chenhLechDoanhThu: revenueDiff,
        chenhLechLoiNhuan: profitDiff,
        trangThaiLuyKe: HIDDEN_LABEL[day.cumulative.hiddenStatus],
      };
    }),
    canhBaoKhiDocFile: report.warnings,
  };
}

/** The Philippines report: every money value comes as peso (₱) and its VND equivalent. */
export function buildPhAnalysisData(report: ProcessedMonthlyFinanceReport) {
  const { summary } = report;
  return {
    boPhan: "Sale Chatpage (Philippines)",
    donViGoc: "PHP (peso). Giá trị 'vnd' là quy đổi theo tỷ giá.",
    tyGiaMacDinh: report.defaultExchangeRate,
    cacTyGiaDaDung: report.exchangeRatesUsed,
    luyKe: {
      doanhThuDuTinh: summary.estimated.revenue,
      doanhThuThucTe: summary.actual.revenue,
      chenhLechDoanhThu: summary.variance.revenue,
      loiNhuanDuTinh: summary.estimated.profit,
      loiNhuanThucTe: summary.actual.profit,
      chenhLechLoiNhuan: summary.variance.profit,
      tongChiPhiBanHang: summary.totalSalesCost,
      tongAds: summary.totalAds,
      tyLeAdsTrenDoanhThuPhanTram: summary.adsRevenueRatio,
    },
    theoNgay: report.days.map((day) => ({
      ngay: day.dateLabel,
      tyGia: day.exchangeRate,
      doanhThuDuTinh: day.comparison.estimated.revenue,
      doanhThuThucTe: day.comparison.actual.revenue,
      loiNhuanDuTinh: day.comparison.estimated.profit,
      loiNhuanThucTe: day.comparison.actual.profit,
      giaVon: day.pnl.cogs,
      ads: day.pnl.ads,
      phiVanChuyen: day.pnl.shippingFees,
      luong: day.pnl.payroll,
      tyLeAdsTrenDoanhThuPhanTram: day.pnl.adsRevenueRatio,
      dongTien: {
        tienDangVe: day.cashflow.moneyInTransit,
        tienChuaDoiSoat: day.cashflow.unverifiedMoney,
        pos: day.cashflow.pos,
        chuyenKhoan: day.cashflow.transfer,
        tong: day.cashflow.total,
      },
      tyLeHoanPhanTram: day.refund.rate,
      xuHuongTyLeHoan: day.refund.trend,
    })),
  };
}
