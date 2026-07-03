"use client";

import { useState } from "react";
import { SHARE_CARD_VERSION } from "@/lib/utils";

const THEMES = [
  { id: "mint", name: "猹绿" },
  { id: "ink", name: "深读蓝" },
  { id: "citrus", name: "柑橘黄" },
  { id: "night", name: "夜读黑" },
  { id: "paper", name: "清单白" },
] as const;

/**
 * 嵌入预览页：演示服务端 OG 卡片可通过 <img src> 直接嵌入。
 * 图片由 /capi/share-card/[id] 路由实时生成 PNG。
 */
export default function ShareCardOgPreviewPage() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]["id"]>("mint");
  const src = `/capi/share-card/demo?theme=${theme}&v=${SHARE_CARD_VERSION}`;

  return (
    <main className="min-h-screen overflow-y-auto bg-zinc-50 px-8 py-10 text-zinc-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-600">
            Pingcha OG Share Card
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">
            服务端分享卡片（可嵌入）
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            图片由 Next.js OG 路由实时渲染，URL 即图片，可直接嵌入公众号 / 飞书 / Notion / 任意网页。
          </p>
          <p className="mt-3 break-all rounded-lg bg-zinc-900 px-3 py-2 font-mono text-xs text-emerald-300">
            {`<img src="${src}" width={410} alt="品猹分享卡" />`}
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition-all ${
                theme === t.id
                  ? "border-zinc-900 bg-white shadow-sm"
                  : "border-zinc-200 bg-white/70 text-zinc-500 hover:border-zinc-300"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div className="flex justify-center rounded-[28px] bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src}
            src={src}
            width={410}
            alt="品猹分享卡"
            className="rounded-xl shadow-lg"
          />
        </div>
      </div>
    </main>
  );
}
