import type { Metadata } from "next";
import ReportGenerator from "@/components/performance-report/report-generator";

export const metadata: Metadata = {
  title: "Báo cáo hiệu suất | Finance Daily",
  description: "Tạo báo cáo hiệu suất kinh doanh từ dữ liệu Excel hoặc CSV.",
};

export default function PerformanceReportPage() {
  return <ReportGenerator />;
}
