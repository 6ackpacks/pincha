import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Instrument_Serif } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

import { Providers } from "@/components/providers";
import { ProcessingQueue } from "@/components/layout/processing-queue";
import { Toaster } from "sonner";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#34d399",
};

export const metadata: Metadata = {
  title: "品猹 — Where Content Becomes Knowledge",
  description: "让信息有归处。品猹整理视频、播客、文章与每日线索，汇入可检索、可追问的个人知识库。",
  icons: {
    icon: [
      { url: "/brand/pincha-script.svg", type: "image/svg+xml" },
    ],
    apple: "/brand/pincha-wordmark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>
      <head>
        {/* Fix: Chrome throttles rAF to ~1fps in background tabs, blocking React
            streaming SSR reveals ($RC / completeBoundary). This tiny shim adds a
            setTimeout fallback so pending rAF callbacks still fire within 3s even
            when the tab is hidden. In foreground tabs rAF wins and the timer is
            cleared — zero perf impact. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof window==='undefined')return;var orig=window.requestAnimationFrame;if(!orig)return;window.requestAnimationFrame=function(cb){var done=false;function run(ts){if(done)return;done=true;clearTimeout(t);cb(ts);}var id=orig(function(ts){run(ts);});var t=setTimeout(function(){run(performance.now());},3000);return id;};})();`,
          }}
        />
        <link rel="preload" as="image" href="/brand/pincha-script.svg" type="image/svg+xml" fetchPriority="high" />
        <link rel="preconnect" href="https://pincha.tos-cn-beijing.volces.com" />
        <link rel="dns-prefetch" href="https://pincha.tos-cn-beijing.volces.com" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          {children}
          <ProcessingQueue />
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                fontSize: "14px",
              },
              className: "font-sans",
            }}
            richColors
          />
        </Providers>
      </body>
    </html>
  );
}
