import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spine 版本转换工具 | 3.2 ~ 4.2 JSON ↔ 二进制互转",
  description:
    "在线转换 Spine 骨骼动画数据：支持 3.2 至 4.2 全版本 JSON 与 .skel 二进制互转，高版本特性自动降级为低版本兼容实现。全部在浏览器本地完成，文件不会上传。",
  keywords: ["Spine", "版本转换", "skeleton", "JSON", "skel", "二进制", " downgrade", "动画"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
