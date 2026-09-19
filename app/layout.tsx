import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Codebase Copilot — MCP server for code search",
  description: "An MCP server that gives Claude Code, Cursor and Claude Desktop hybrid semantic search over any repository. AST chunking, local embeddings, BM25, measured retrieval quality.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await headers(); // opt into dynamic rendering so every response carries a fresh CSP nonce
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
