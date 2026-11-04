import type { Metadata } from "next";
import { AdsPage } from "@/components/ads/ads-page";

export const metadata: Metadata = {
  title: "Quảng cáo Meta | Finance Daily",
  description: "Chi tiêu, ROAS, tin nhắn và chiến dịch quảng cáo Meta lấy qua Ads MCP.",
};

export default function AdsRoute() {
  return <AdsPage />;
}
