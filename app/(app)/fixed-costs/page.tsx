import type { Metadata } from "next";
import { CostManager } from "@/components/costs/cost-manager";

export const metadata: Metadata = {
  title: "Chi phí cố định | NextG",
  description: "Nhập lương, định phí, ads và các chi phí không có trong Pancake POS; lưu vào MySQL để báo cáo tự lấy.",
};

export default function FixedCostsPage() {
  return <CostManager />;
}
