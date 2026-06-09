"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { addToQueueAtom } from "@/atoms/queue";
import { submitVideo, submitArticle } from "@/lib/api";
import {
  LinkSimple,
  Sparkle,
  FileText,
  CircleNotch,
  ArrowRight,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  PLACEHOLDERS,
  useTypewriter,
  PlatformTabs,
  type Platform,
} from "@/components/home/shared";

export function HeroSection() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const addToQueue = useSetAtom(addToQueueAtom);
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [flyingItem, setFlyingItem] = useState<{ title: string; key: number } | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [platform, setPlatform] = useState<Platform>("youtube");
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { displayText, stop, start } = useTypewriter(PLACEHOLDERS);

  const handleSubmitUrl = async () => {
    const url = urlInput.trim();
    if (!url || submitting) return;

    const isValidUrl = url.startsWith("http://") || url.startsWith("https://");
    if (!isValidUrl) return;

    setSubmitting(true);
    try {
      if (platform === "article") {
        const article = await submitArticle(url);
        if (article.status?.state === "done") {
          router.push(`/articles/${article.id}`);
        } else {
          addToQueue({ id: article.id, type: "article", title: article.title || url, state: "processing", progress: 0, message: "开始品读" });
          setFlyingItem({ title: article.title || url, key: Date.now() });
        }
      } else if (platform === "podcast") {
        const video = await submitVideo(url, "podcast");
        queryClient.invalidateQueries({ queryKey: ["videos"] });
        // Always navigate to detail page immediately
        addToQueue({ id: video.id, type: "video", title: video.title || url, state: video.status?.state || "processing", progress: 0, message: "开始品读" });
        router.push(`/videos/${video.id}`);
      } else {
        const video = await submitVideo(url, "youtube");
        queryClient.invalidateQueries({ queryKey: ["videos"] });
        // Always navigate to detail page immediately
        addToQueue({ id: video.id, type: "video", title: video.title || url, state: video.status?.state || "processing", progress: 0, message: "开始品读" });
        router.push(`/videos/${video.id}`);
      }
      setUrlInput("");
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  const handleSubmitText = async () => {
    const text = textInput.trim();
    if (!text || submitting) return;

    const isUrl = text.startsWith("http://") || text.startsWith("https://");
    if (!isUrl && text.length < 20) return;

    setSubmitting(true);
    try {
      if (isUrl) {
        const article = await submitArticle(text);
        if (article.status?.state === "done") {
          router.push(`/articles/${article.id}`);
        } else {
          addToQueue({ id: article.id, type: "article", title: article.title || text, state: "processing", progress: 0, message: "开始品读" });
          setFlyingItem({ title: article.title || text, key: Date.now() });
        }
      } else {
        const article = await submitArticle("", text);
        if (article.status?.state === "done") {
          router.push(`/articles/${article.id}`);
        } else {
          addToQueue({ id: article.id, type: "article", title: article.title || text.slice(0, 30) + "...", state: "processing", progress: 0, message: "开始品读" });
          setFlyingItem({ title: article.title || text.slice(0, 30), key: Date.now() });
        }
      }
      setTextInput("");
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setTextInput(content);
    };
    reader.readAsText(file);
  };

  const handleFocus = () => { setIsFocused(true); stop(); };
  const handleBlur = () => { if (!urlInput) { setIsFocused(false); start(); } };

  return (
    <>
      {/* Flying item animation */}
      <AnimatePresence>
        {flyingItem && (
          <motion.div
            key={flyingItem.key}
            initial={{ opacity: 1, y: 0, x: 0, scale: 1 }}
            animate={{ opacity: 0, y: -60, x: 200, scale: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            onAnimationComplete={() => setFlyingItem(null)}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/30 pointer-events-none"
          >
            已加入整理队列
          </motion.div>
        )}
      </AnimatePresence>

      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50/60 to-white">
        {/* Right-side hero image */}
        <div className="absolute top-0 right-0 w-[55%] h-full pointer-events-none">
          <img
            src="/hero-workspace.jpg"
            alt=""
            className="w-full h-full object-cover object-[80%_30%]"
            style={{ maskImage: "linear-gradient(to right, transparent 0%, black 25%)", WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 25%)" }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 px-8 pt-14 pb-12">
          <div className="max-w-xl">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold"
            >
              <Sparkle size={12} weight="bold" />
              品猹 · Where Content Becomes Knowledge
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mt-6 text-[42px] lg:text-[48px] font-extrabold tracking-tight leading-[1.12] text-zinc-900"
            >
              让信息
              <br />
              有<span className="text-emerald-500">归处</span>
            </motion.h1>

          </div>

          {/* Input area */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mt-8 max-w-4xl"
          >
            {platform === "article" ? (
              <div className={cn(
                "rounded-2xl border bg-white transition-all duration-300 p-5",
                isFocused
                  ? "border-emerald-300 shadow-[0_4px_24px_-4px_rgba(16,185,129,0.15)]"
                  : "border-zinc-200 shadow-lg shadow-black/5"
              )}>
                <textarea
                  ref={textareaRef}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="粘贴文章链接，或放入一段值得细读的文字..."
                  className="w-full h-32 bg-transparent text-sm focus:outline-none text-zinc-900 placeholder:text-zinc-400 resize-none"
                />
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100">
                  <div className="flex items-center gap-3">
                    <input ref={fileInputRef} type="file" accept=".txt,.md,.html" className="hidden" onChange={handleFileUpload} />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-500 bg-zinc-50 rounded-lg border border-zinc-200 hover:bg-zinc-100 transition-colors"
                    >
                      <FileText size={12} weight="bold" />
                      上传文件
                    </button>
                    <span className="text-[11px] text-zinc-400">支持 .txt / .md / .html</span>
                  </div>
                  <button
                    onClick={handleSubmitText}
                    disabled={!textInput.trim() || submitting}
                    className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white rounded-xl bg-emerald-500 hover:bg-emerald-600 shadow-md shadow-emerald-500/20 disabled:opacity-40 transition-all"
                  >
                    {submitting ? <CircleNotch size={14} weight="bold" className="animate-spin" /> : <ArrowRight size={14} weight="bold" />}
                    开始品读
                  </button>
                </div>
              </div>
            ) : (
              <div className={cn(
                "flex items-center rounded-2xl border bg-white transition-all duration-300",
                isFocused
                  ? "border-emerald-300 shadow-[0_4px_24px_-4px_rgba(16,185,129,0.15)]"
                  : "border-zinc-200 shadow-lg shadow-black/5 hover:shadow-xl hover:border-zinc-300"
              )} style={{ height: "80px" }}>
                <div className="flex-1 flex items-center gap-4 px-6 h-full">
                  <LinkSimple size={20} weight="bold" className="text-zinc-300 shrink-0" />
                  <div className="flex-1 relative">
                    <input
                      ref={inputRef}
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSubmitUrl(); }}
                      onFocus={handleFocus}
                      onBlur={handleBlur}
                      placeholder=""
                      className="w-full bg-transparent text-base focus:outline-none text-zinc-900"
                    />
                    {!urlInput && !isFocused && (
                      <span className="absolute inset-0 flex items-center text-base text-zinc-400 pointer-events-none">
                        {displayText}
                        <span className="ml-0.5 w-[2px] h-5 bg-emerald-400 animate-pulse" />
                      </span>
                    )}
                  </div>
                </div>
                <div className="pr-2.5">
                  <button
                    onClick={handleSubmitUrl}
                    disabled={submitting || !urlInput.trim()}
                    className="flex items-center gap-2 px-6 py-3 text-sm font-bold text-white rounded-xl bg-emerald-500 hover:bg-emerald-600 shadow-md shadow-emerald-500/20 hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 transition-all"
                  >
                    {submitting ? <CircleNotch size={14} weight="bold" className="animate-spin" /> : <ArrowRight size={14} weight="bold" />}
                    开始品读
                  </button>
                </div>
              </div>
            )}

            {/* Mode tabs */}
            <PlatformTabs platform={platform} onChange={setPlatform} />

          </motion.div>
        </div>
      </section>
    </>
  );
}
