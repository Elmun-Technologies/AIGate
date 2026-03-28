import "./globals.css";
import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";

import Nav from "@/components/Nav";
import ClientProviders from "@/components/ClientProviders";

export const metadata: Metadata = {
  title: "Agent Proxy Gateway",
  description: "Inline enforcement control plane",
};

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "700"],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${ibmPlexMono.variable}`}>
        <ClientProviders><Nav>{children}</Nav></ClientProviders>
      </body>
    </html>
  );
}
