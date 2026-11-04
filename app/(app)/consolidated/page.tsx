import type { Metadata } from "next";
import { ConsolidatedReport } from "@/components/consolidated/consolidated-report";

export const metadata: Metadata = {
  title: "Báo cáo tổng hợp | NextG",
  description: "Xem các báo cáo ngày, hiệu suất và quản trị tài chính (Việt, Philippines) trong cùng một trang từ một file Excel.",
};

export default function ConsolidatedPage() {
  return <ConsolidatedReport />;
}
