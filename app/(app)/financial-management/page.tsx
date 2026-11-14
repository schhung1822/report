import type { Metadata } from "next";
import FinancialManagementReportGenerator from "@/components/financial-management/report-generator";

export const metadata: Metadata = {
  title: "Báo cáo quản trị tài chính | NextG",
  description:
    "Tạo báo cáo quản trị tài chính, đối chiếu dự tính và thực tế theo kênh Zalo, Page.",
};

export default function FinancialManagementPage() {
  return <FinancialManagementReportGenerator />;
}
