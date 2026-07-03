"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import { addToQueueAtom } from "@/atoms/queue";
import { submitVideo, submitArticle } from "@/lib/api";
import { UI_LABELS } from "@/lib/constants";
import {
  LinkSimple,
  Sparkle,
  FileText,
  CircleNotch,
  ArrowRight,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { cdnUrl } from "@/lib/cdn";
import {
  PLACEHOLDERS,
  useTypewriter,
  PlatformTabs,
  type Platform,
} from "@/components/home/shared";
import { NoSubtitleDialog } from "@/components/video/no-subtitle-dialog";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"]);
const PODCAST_HOSTS = new Set(["xiaoyuzhoufm.com", "www.xiaoyuzhoufm.com", "ximalaya.com", "www.ximalaya.com", "podcasts.apple.com"]);

function getUrlHost(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isYouTubeUrl(url: string): boolean {
  const host = getUrlHost(url);
  return YOUTUBE_HOSTS.has(host);
}

function isPodcastUrl(url: string): boolean {
  const host = getUrlHost(url);
  return [...PODCAST_HOSTS].some(h => host === h || host.endsWith("." + h));
}

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
  const [showNoSubtitle, setShowNoSubtitle] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);

  const { displayText, stop, start } = useTypewriter(PLACEHOLDERS);

  const handleSubmitUrl = async () => {
    const url = urlInput.trim();
    if (!url || submitting || isSubmittingRef.current) return;

    const isValidUrl = url.startsWith("http://") || url.startsWith("https://");
    if (!isValidUrl) {
      toast.error(UI_LABELS.ERROR_INVALID_URL);
      return;
    }

    if (platform === "youtube" && !isYouTubeUrl(url)) {
      toast.error("当前仅支持 YouTube 视频链接");
      return;
    }
    if (platform === "podcast" && !isPodcastUrl(url)) {
      toast.error("当前仅支持小宇宙、喜马拉雅和 Apple Podcasts 链接");
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      if (platform === "article") {
        const article = await submitArticle(url);
        if (article.status?.state === "done") {
          router.push(`/articles/${article.id}`);
        } else {
          addToQueue({ id: article.id, type: "article", title: article.title || url, state: "processing", progress: 0, message: UI_LABELS.START_PROCESSING });
          setFlyingItem({ title: article.title || url, key: Date.now() });
        }
      } else {
        // Handle video platforms (podcast, youtube)
        const video = await submitVideo(url, platform);
        queryClient.invalidateQueries({ queryKey: ["videos"] });
        addToQueue({ id: video.id, type: "video", title: video.title || url, state: "processing", progress: 0, message: UI_LABELS.START_PROCESSING });
        router.push(`/videos/${video.id}`);
      }
      setUrlInput("");
    } catch (error) {
      console.error("Failed to submit URL:", error);
      const errMsg = error instanceof Error ? error.message : "";
      if (errMsg.includes("subtitle") || errMsg.includes("字幕")) {
        setShowNoSubtitle(true);
      } else if (error instanceof TypeError && error.message === "Failed to fetch") {
        toast.error(UI_LABELS.ERROR_NETWORK);
      } else {
        toast.error(UI_LABELS.ERROR_SUBMIT);
      }
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmitText = async () => {
    const text = textInput.trim();
    if (!text || submitting || isSubmittingRef.current) return;

    const isUrl = text.startsWith("http://") || text.startsWith("https://");
    if (!isUrl && text.length < 20) return;

    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      if (isUrl) {
        const article = await submitArticle(text);
        if (article.status?.state === "done") {
          router.push(`/articles/${article.id}`);
        } else {
          addToQueue({ id: article.id, type: "article", title: article.title || text, state: "processing", progress: 0, message: UI_LABELS.START_PROCESSING });
          setFlyingItem({ title: article.title || text, key: Date.now() });
        }
      } else {
        const article = await submitArticle("", text);
        if (article.status?.state === "done") {
          router.push(`/articles/${article.id}`);
        } else {
          addToQueue({ id: article.id, type: "article", title: article.title || text.slice(0, 30) + "...", state: "processing", progress: 0, message: UI_LABELS.START_PROCESSING });
          setFlyingItem({ title: article.title || text.slice(0, 30), key: Date.now() });
        }
      }
      setTextInput("");
    } catch (error) {
      console.error("Failed to submit text:", error);
      if (error instanceof TypeError && error.message === "Failed to fetch") {
        toast.error(UI_LABELS.ERROR_NETWORK);
      } else {
        toast.error(UI_LABELS.ERROR_SUBMIT);
      }
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
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
            {UI_LABELS.QUEUE_ADDED}
          </motion.div>
        )}
      </AnimatePresence>

      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50/60 to-white">
        {/* Right-side hero image */}
        <div className="absolute top-0 right-0 w-[55%] h-full pointer-events-none">
          <img
            src={cdnUrl("/hero-workspace.jpg")}
            alt="整洁的工作空间环境，展示品猹平台的专业知识管理氛围"
            loading="eager"
            fetchPriority="high"
            width={1920}
            height={1080}
            className="w-full h-full object-cover object-[80%_30%]"
            style={{ maskImage: "linear-gradient(to right, transparent 0%, black 25%)", WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 25%)" }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 px-8 pt-14 pb-12">
          <div className="max-w-[720px]">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold"
            >
              <Sparkle size={12} weight="bold" aria-hidden="true" />
              品猹 · AI Content Workspace
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mt-6 font-black leading-[1.08] text-zinc-950"
              style={{
                fontSize: "clamp(2.75rem, 1.9rem + 3.8vw, 4.25rem)",
                letterSpacing: "0",
                fontFamily: "var(--font-geist-sans), 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
                textWrap: "balance",
              }}
            >
              让信息有<span className="text-emerald-600">归处</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mt-4 text-zinc-500 font-medium"
              style={{
                fontSize: "clamp(1.125rem, 0.9rem + 0.9vw, 1.45rem)",
                letterSpacing: "0",
              }}
            >
              Where Content Becomes Knowledge.
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mt-3 text-base text-zinc-500 font-medium"
            >
              让内容清晰，让价值沉淀
            </motion.p>

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
                  aria-label="输入文章链接或文本内容"
                />
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100">
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.html"
                      className="hidden"
                      onChange={handleFileUpload}
                      aria-label="上传文本文件"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-500 bg-zinc-50 rounded-lg border border-zinc-200 hover:bg-zinc-100 transition-colors"
                      aria-label="选择并上传文本文件"
                    >
                      <FileText size={12} weight="bold" aria-hidden="true" />
                      上传文件
                    </button>
                    <span className="text-[11px] text-zinc-400">支持 .txt / .md / .html</span>
                  </div>
                  <button
                    onClick={handleSubmitText}
                    disabled={!textInput.trim() || submitting}
                    className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white rounded-xl bg-emerald-500 hover:bg-emerald-600 shadow-md shadow-emerald-500/20 disabled:opacity-40 transition-all"
                    aria-label="提交文章内容并开始品读"
                  >
                    {submitting ? <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" /> : <ArrowRight size={14} weight="bold" aria-hidden="true" />}
                    {UI_LABELS.START_PROCESSING}
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
                  <LinkSimple size={20} weight="bold" className="text-zinc-300 shrink-0" aria-hidden="true" />
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
                      aria-label="输入视频或播客链接"
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
                    aria-label="提交链接并开始品读"
                  >
                    {submitting ? <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" /> : <ArrowRight size={14} weight="bold" aria-hidden="true" />}
                    {UI_LABELS.START_PROCESSING}
                  </button>
                </div>
              </div>
            )}

            {/* Mode tabs */}
            <PlatformTabs platform={platform} onChange={setPlatform} />

          </motion.div>
        </div>
      </section>

      <NoSubtitleDialog open={showNoSubtitle} onClose={() => setShowNoSubtitle(false)} />
    </>
  );
}
