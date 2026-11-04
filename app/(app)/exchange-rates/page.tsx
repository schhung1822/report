import type { Metadata } from "next";
import { RateManager } from "@/components/rates/rate-manager";

export const metadata: Metadata = {
  title: "Tỷ giá | Finance Daily",
  description: "Nhập tỷ giá PHP → VND tự đặt, có lịch sử; báo cáo luôn dùng mức mới nhất.",
};

export default function ExchangeRatesPage() {
  return <RateManager />;
}
