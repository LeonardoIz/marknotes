import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Lora } from "next/font/google";
import { Suspense } from "react";
import "katex/dist/katex.min.css";
import "./globals.css";
import { LiveUpdates } from "@/components/LiveUpdates";
import { NavBar } from "@/components/NavBar";
import { SearchModal } from "@/components/SearchModal";
import { Toaster } from "@/components/ui";
import { themeScript } from "@/lib/theme";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const serif = Lora({ variable: "--font-serif", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "marknotes", template: "%s - marknotes" },
  description: "Your markdown notes.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e0d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${serif.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning className="flex min-h-svh flex-col">
        {/* Both read the URL, which is only known per request. */}
        <Suspense fallback={<div className="h-14" />}>
          <NavBar />
        </Suspense>
        <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-4 pt-10 pb-16 md:px-10">{children}</main>
        <Suspense>
          <SearchModal />
          <LiveUpdates />
        </Suspense>
        <Toaster />
      </body>
    </html>
  );
}
