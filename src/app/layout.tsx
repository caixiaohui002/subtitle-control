import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "智能文本处理",
  description: "删除报幕信息 · 标点符号断行 · LLM 语义拆分",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
