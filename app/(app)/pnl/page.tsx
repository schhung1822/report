import type { Metadata } from "next";
import { PnlSheet } from "@/components/pnl/pnl-sheet";

export const metadata: Metadata = {
  title: "Bảng lợi nhuận | NextG",
  description: "Báo cáo quản trị lợi nhuận theo ngày của từng shop; nhập chi phí trực tiếp trên bảng.",
};

export default function PnlPage() {
  return <PnlSheet />;
}
