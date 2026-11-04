import type { Metadata } from "next";
import { AnalyticsPage } from "@/components/analytics/analytics-page";

export const metadata: Metadata = {
  title: "Phân tích vận hành | Finance Daily",
  description: "Tỷ lệ hoàn, chốt đơn, ROAS, COD và cơ cấu bán hàng từ dữ liệu Pancake POS.",
};

export default function AnalyticsRoute() {
  return <AnalyticsPage />;
}
