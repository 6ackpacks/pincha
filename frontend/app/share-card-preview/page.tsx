"use client";

import { useState } from "react";
import {
  SHARE_CARD_THEME_IDS,
  SHARE_CARD_THEMES,
  type ShareCardThemeId,
} from "@/components/video/share-card-themes";
import { SHARE_CARD_VERSION } from "@/lib/utils";

export default function ShareCardPreviewPage() {
  const [selected, setSelected] = useState<ShareCardThemeId>("mint");
  const selectedTheme = SHARE_CARD_THEMES[selected];
  const previewSrc = `/capi/share-card/demo?theme=${selected}&v=${SHARE_CARD_VERSION}`;

  return (
    <main className="min-h-screen overflow-y-auto bg-[#f6faf5] px-8 py-8 text-zinc-950">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-600">
              Pingcha Share Poster
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">分享总结海报预览</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              直接预览服务端 PNG 输出：封面标题、摘要面板、五条核心总结和底部二维码 CTA。
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-zinc-400">当前选择</p>
            <p className="text-sm font-bold" style={{ color: selectedTheme.accentText }}>
              {selectedTheme.name} · {selectedTheme.description}
            </p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-5 gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
          {SHARE_CARD_THEME_IDS.map((id) => {
            const theme = SHARE_CARD_THEMES[id];
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                className="flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all"
                style={{
                  borderColor: selected === id ? theme.accent : "#e4e4e7",
                  background: selected === id ? theme.shellBg : "#ffffff",
                }}
              >
                <span className="flex h-9 w-12 shrink-0 overflow-hidden rounded-full border border-white shadow-sm">
                  {theme.swatch.map((color) => (
                    <span key={color} className="flex-1" style={{ background: color }} />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{theme.name}</span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {theme.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <section className="flex justify-center rounded-[28px] bg-white/70 p-6 shadow-sm ring-1 ring-zinc-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={previewSrc}
            src={previewSrc}
            width={432}
            alt={`${selectedTheme.name}分享总结海报`}
            className="h-auto rounded-[18px] shadow-xl"
          />
        </section>
      </div>
    </main>
  );
}
