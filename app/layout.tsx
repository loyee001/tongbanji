import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "同班记 · 班级积分",
  description: "记录全班的加分与减分，查看周榜，导出班级积分报表。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
