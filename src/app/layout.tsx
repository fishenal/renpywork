import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ren'Py Work — 本地文本编辑器",
  description: "通用 Ren'Py 工程源文检视与编辑（本地优先）",
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
