import { DAILY_SAMPLE_DATA } from "@/lib/daily-report";

/** Sheet names in the template. The reader matches sheets by these keywords, so keep them recognizable. */
export const TEMPLATE_SHEETS = {
  guide: "Hướng dẫn",
  daily: "Báo cáo ngày",
  performanceDaily: "Hiệu suất - Ngày",
  performanceCumulative: "Hiệu suất - Lũy kế",
  vn: "QTTC Việt (CSKH Zalo)",
  ph: "QTTC Philippines (Peso)",
} as const;

type Cell = string | number;

const GUIDE_ROWS: Cell[][] = [
  ["MẪU BÁO CÁO TỔNG HỢP"],
  ["Điền số liệu vào từng sheet bên dưới rồi tải file lên trang Báo cáo tổng hợp. Giữ nguyên tên sheet và tên cột (dòng 1). Sheet nào để trống sẽ không hiển thị tab."],
  [],
  ["Sheet", "Dùng cho", "Lưu ý"],
  [TEMPLATE_SHEETS.daily, "Tab Báo cáo ngày", "Dòng đầu điền Ngày, Doanh số, Chuyển khoản, COD, Phí VC. Mỗi khoản chi là một dòng (Người chi, Tên NCC, Số tiền chi). Tiền: VND."],
  [TEMPLATE_SHEETS.performanceDaily, "Tab Hiệu suất", "Mỗi dòng là một nhân sự. Tên có chữ CSKH hoặc PAGE để được gom nhóm trong biểu đồ cơ cấu doanh thu. Tiền: VND."],
  [TEMPLATE_SHEETS.performanceCumulative, "Tab Hiệu suất (lũy kế tháng)", "Không bắt buộc. Nếu bỏ trống, bảng xếp hạng lũy kế sẽ trống."],
  [TEMPLATE_SHEETS.vn, "Tab Quản trị TC – Việt", "Nhóm CSKH Zalo. Mỗi ngày 2 dòng: Type = Dự tính / Thực tế. Channel = Zalo. Top sản phẩm dạng: Tên: giá trị; Tên: giá trị. Tiền: VND."],
  [TEMPLATE_SHEETS.ph, "Tab Quản trị TC – Philippines", "Bộ phận Sale Chatpage. Mọi số tiền nhập bằng Peso (PHP). Cột Tỷ giá (PHP→VND) có thể để trống để dùng tỷ giá mặc định ngay trên trang. Tỷ lệ hoàn nhập 0–100 (hoặc 0–1), hoặc dùng Tổng đơn và Đơn hoàn. Lợi nhuận thực tế để trống thì tự tính = Doanh thu thực tế − (Giá vốn + Ads + Vận chuyển + Lương)."],
];

function dailyRows(): Cell[][] {
  const { reportDate, revenue, bankTransfer, codReceivable, shippingFee, expenses } = DAILY_SAMPLE_DATA;
  return [
    ["Ngày báo cáo", "Doanh số", "Nhận tiền chuyển khoản", "Tiền phải thu khách (COD)", "Phí trả đơn vị VC", "Người chi", "Tên NCC", "Số tiền chi"],
    ...expenses.map((expense, index): Cell[] =>
      index === 0
        ? [reportDate, revenue, bankTransfer, codReceivable, shippingFee, expense.payer, expense.supplier, expense.amount]
        : ["", "", "", "", "", expense.payer, expense.supplier, expense.amount],
    ),
  ];
}

const PERFORMANCE_DAILY_ROWS: Cell[][] = [
  ["Ngày báo cáo", "Tên nhân sự", "Tổng tiền đơn hàng", "Giá vốn đơn ban đầu", "Chi phí vận chuyển", "Chi phí lương", "Chi phí cố định", "Chi phí ads"],
  ["02/11/2026", "DIỆU LINH CSKH", 68_500_000, 31_200_000, 4_100_000, 5_500_000, 2_100_000, 7_800_000],
  ["", "NGỌC ANH CSKH", 55_800_000, 27_400_000, 3_600_000, 5_200_000, 1_900_000, 6_900_000],
  ["", "THU HÀ CSKH", 42_700_000, 20_600_000, 3_100_000, 4_800_000, 1_800_000, 5_500_000],
  ["", "HỒNG PAGE 1", 74_200_000, 36_800_000, 4_900_000, 5_900_000, 2_200_000, 9_600_000],
  ["", "TRANG PAGE 2", 61_300_000, 31_700_000, 4_300_000, 5_600_000, 2_100_000, 8_100_000],
  ["", "MINH PAGE 3", 28_900_000, 17_600_000, 2_900_000, 4_700_000, 1_700_000, 6_200_000],
];

const PERFORMANCE_CUMULATIVE_ROWS: Cell[][] = [
  ["Tên nhân sự", "Tổng số đơn", "Đơn thành công", "Doanh thu tổng lên đơn", "Lợi nhuận tổng lên đơn", "Doanh thu thực nhận", "Lợi nhuận thực nhận"],
  ["DIỆU LINH CSKH", 568, 491, 1_625_000_000, 412_000_000, 1_428_000_000, 354_000_000],
  ["HỒNG PAGE 1", 602, 503, 1_744_000_000, 398_000_000, 1_502_000_000, 321_000_000],
  ["NGỌC ANH CSKH", 511, 431, 1_420_000_000, 338_000_000, 1_236_000_000, 286_000_000],
  ["TRANG PAGE 2", 496, 402, 1_362_000_000, 306_000_000, 1_148_000_000, 247_000_000],
  ["THU HÀ CSKH", 447, 359, 1_184_000_000, 264_000_000, 987_000_000, 211_000_000],
  ["MINH PAGE 3", 389, 296, 918_000_000, 176_000_000, 744_000_000, 137_000_000],
];

const VN_HEADERS: Cell[] = [
  "Date", "Type", "Channel", "Revenue", "COGS", "Return_Provision", "Salary_Sale_CSKH", "Salary_Other",
  "Fixed_Cost", "Other_Cost", "Ads_Cost", "Top_Revenue_Products", "Top_Profit_Products",
];

function vnRow(date: string, type: "Dự tính" | "Thực tế", revenue: number, cogs: number, returns: number, product: string): Cell[] {
  return [
    date, type, "Zalo", revenue, cogs, returns, 15_000_000, 6_000_000, 8_000_000, 3_000_000, 0,
    `${product} Premium: ${Math.round(revenue * 0.42)}; ${product} Classic: ${Math.round(revenue * 0.31)}; ${product} Basic: ${Math.round(revenue * 0.17)}`,
    `${product} Premium: ${Math.round(revenue * 0.13)}; ${product} Classic: ${Math.round(revenue * 0.08)}; ${product} Basic: ${Math.round(revenue * 0.04)}`,
  ];
}

const VN_ROWS: Cell[][] = [
  VN_HEADERS,
  vnRow("01/11/2026", "Dự tính", 165_000_000, 72_000_000, 13_000_000, "Serum"),
  vnRow("01/11/2026", "Thực tế", 158_000_000, 74_000_000, 15_000_000, "Serum"),
  vnRow("02/11/2026", "Dự tính", 172_000_000, 76_000_000, 14_000_000, "Toner"),
  vnRow("02/11/2026", "Thực tế", 168_000_000, 79_000_000, 16_000_000, "Toner"),
  vnRow("03/11/2026", "Dự tính", 180_000_000, 78_000_000, 14_000_000, "Mặt nạ"),
  vnRow("03/11/2026", "Thực tế", 171_000_000, 82_000_000, 17_000_000, "Mặt nạ"),
];

const PH_ROWS: Cell[][] = [
  [
    "Ngày", "Tỷ giá PHP-VND", "Doanh thu dự tính", "Lợi nhuận dự tính", "Doanh thu thực tế", "Lợi nhuận thực tế",
    "Giá vốn", "Chi phí ads", "Phí vận chuyển", "Chi phí lương", "Tiền đang về", "Tiền chưa đối soát", "POS",
    "Chuyển khoản", "Tỷ lệ hoàn (%)", "Tổng đơn", "Đơn hoàn",
  ],
  ["01/11/2026", 450, 420_000, 95_000, 405_000, "", 190_000, 62_000, 28_000, 31_000, 54_000, 18_000, 22_000, 140_000, "", 310, 41],
  ["02/11/2026", 452, 440_000, 100_000, 462_000, "", 205_000, 66_000, 30_000, 31_000, 61_000, 15_000, 25_000, 168_000, "", 335, 38],
  ["03/11/2026", 451, 455_000, 104_000, 430_000, "", 198_000, 71_000, 29_500, 31_000, 58_000, 21_000, 20_000, 152_000, "", 322, 44],
  ["04/11/2026", 455, 470_000, 108_000, 489_000, "", 214_000, 69_000, 31_000, 31_000, 66_000, 12_000, 28_000, 181_000, "", 350, 36],
  ["05/11/2026", 455, 480_000, 110_000, 471_000, "", 209_000, 74_000, 30_500, 31_000, 63_000, 17_000, 24_000, 172_000, "", 341, 39],
];

const COLUMN_WIDTHS: Record<string, number[]> = {
  [TEMPLATE_SHEETS.guide]: [34, 30, 120],
  [TEMPLATE_SHEETS.daily]: [16, 16, 24, 26, 20, 14, 22, 16],
  [TEMPLATE_SHEETS.performanceDaily]: [16, 22, 22, 24, 22, 18, 18, 16],
  [TEMPLATE_SHEETS.performanceCumulative]: [22, 16, 18, 26, 26, 24, 24],
  [TEMPLATE_SHEETS.vn]: [12, 10, 10, 14, 14, 18, 18, 16, 14, 14, 14, 70, 70],
  [TEMPLATE_SHEETS.ph]: [12, 16, 18, 18, 18, 18, 14, 14, 16, 16, 16, 20, 12, 16, 16, 12, 12],
};

/** Builds the multi-sheet Excel template (filled with sample data) and returns it as an .xlsx buffer. */
export async function buildConsolidatedTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const sheets: [string, Cell[][]][] = [
    [TEMPLATE_SHEETS.guide, GUIDE_ROWS],
    [TEMPLATE_SHEETS.daily, dailyRows()],
    [TEMPLATE_SHEETS.performanceDaily, PERFORMANCE_DAILY_ROWS],
    [TEMPLATE_SHEETS.performanceCumulative, PERFORMANCE_CUMULATIVE_ROWS],
    [TEMPLATE_SHEETS.vn, VN_ROWS],
    [TEMPLATE_SHEETS.ph, PH_ROWS],
  ];
  for (const [name, rows] of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = (COLUMN_WIDTHS[name] ?? []).map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
