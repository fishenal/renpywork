import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ren'Py Work",
  description: "通用 Ren'Py 工程：脚本编辑与资源浏览（本地优先）",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
