import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ProcessingQueue } from "@/components/layout/processing-queue";

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
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    apple: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@700&display=block" rel="stylesheet" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://i0.hdslb.com" />
        <link rel="dns-prefetch" href="https://i0.hdslb.com" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          {children}
          <ProcessingQueue />
        </Providers>
      </body>
    </html>
  );
}
