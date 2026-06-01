import type { Metadata } from "next";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lovart Desk",
  description: "Personal image canvas and agent workbench"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
