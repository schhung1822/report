import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
});

export const metadata: Metadata = {
  title: "Finance Daily | Báo cáo tài chính nội bộ",
  description: "Tạo báo cáo tài chính hàng ngày từ dữ liệu Excel hoặc CSV.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-muted/40">{children}</body>
    </html>
  );
}
