"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { ArrowLeft, ArrowSquareOut, BookmarkSimple, CheckCircle, CircleNotch, Clock, Database, ListBullets, Play, TextAlignLeft, TreeStructure } from "@phosphor-icons/react";
import { Sidebar } from "@/components/layout/sidebar";
import { AudioPlayer } from "@/components/audio/audio-player";
import { addVideoToLibrary, getPublicVideoFull, proxyThumbnail, type SummaryLevel, type SummaryResponse, type TranscriptSegment } from "@/lib/api";
import { cn, formatTime, stripMarkdown } from "@/lib/utils";
import type { Transformer as TransformerClass } from "markmap-lib";
import type { Markmap } from "markmap-view";

const TABS = [
  { key: "transcript", label: "文字稿", icon: TextAlignLeft },
  { key: "summary", label: "摘记", icon: ListBullets },
  { key: "mindmap", label: "脉络图", icon: TreeStructure },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const SUMMARY_LABELS: Record<SummaryLevel, string> = {
  express: "速览",
  highlight: "要点",
  detailed: "详细",
  full: "完整",
};

const SUMMARY_ORDER: SummaryLevel[] = ["detailed", "highlight", "express", "full"];

let Transformer: typeof TransformerClass | null = null;
let MarkmapView: typeof Markmap | null = null;

function stripMindmapTimestamps(markdown: string): string {
  return markdown.replace(/\s*\[\d{1,3}:\d{2}\]/g, "");
}

export default function PublicVideoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const videoId = params.id;
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [activeSummaryLevel, setActiveSummaryLevel] = useState<SummaryLevel>("detailed");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["public-video-full", videoId],
    queryFn: () => getPublicVideoFull(videoId),
    enabled: !!videoId,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const video = data?.video;
  const summaries = useMemo(() => {
    const map = new Map<SummaryLevel, SummaryResponse>();
    for (const summary of data?.summaries ?? []) map.set(summary.level, summary);
    return map;
  }, [data?.summaries]);
  const activeSummary = summaries.get(activeSummaryLevel) ?? [...summaries.values()][0];
  const segments = data?.transcript?.segments ?? [];

  const addToLibraryMutation = useMutation({
    mutationFn: () => addVideoToLibrary(videoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      // 失效公开详情缓存，使返回后按钮显示"进入解析"而非再次"加入我的解析"
      queryClient.invalidateQueries({ queryKey: ["public-video-full", videoId] });
    },
  });

  const handleAddToLibrary = async () => {
    // 已在库中：直接进入，无需再次调用加入接口
    if (video?.in_library) {
      router.push(`/videos/${videoId}`);
      return;
    }
    try {
      await addToLibraryMutation.mutateAsync();
      toast.success("已加入我的解析");
      router.push(`/videos/${videoId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加入失败，请稍后重试");
    }
  };

  const handleAddToKnowledge = async () => {
    try {
      // 已在库中则跳过幂等的加入调用，直接带参进入
      if (!video?.in_library) {
        await addToLibraryMutation.mutateAsync();
      }
      router.push(`/videos/${videoId}?addToKnowledge=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加入知识库失败，请稍后重试");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen bg-[#FAFAFA]">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="h-full rounded-2xl bg-white border border-zinc-100 animate-pulse" />
        </main>
      </div>
    );
  }

  if (isError || !video) {
    return (
      <div className="flex h-screen bg-[#FAFAFA]">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="rounded-2xl bg-white border border-zinc-100 px-8 py-10 text-center">
            <p className="text-sm font-bold text-zinc-900">无法打开这个热门内容</p>
            <p className="mt-2 text-xs text-zinc-400">{error instanceof Error ? error.message : "内容不存在或暂不可公开访问"}</p>
            <button onClick={() => router.push("/")} className="mt-5 px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-bold">
              返回首页
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#FAFAFA] overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="sticky top-0 z-20 h-[60px] px-6 flex items-center gap-4 bg-white/80 backdrop-blur-md border-b border-zinc-200">
          <button onClick={() => router.back()} className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all">
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            返回
          </button>
          <h1 className="text-sm font-bold text-zinc-900 truncate flex-1">{stripMarkdown(video.title) || "热门品读"}</h1>
          {video.duration && (
            <span className="hidden sm:flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200/60">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              {video.duration}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
            <CheckCircle className="w-3.5 h-3.5" />
            已完成
          </span>
        </header>

        <section className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[55%_45%] overflow-y-auto lg:overflow-hidden">
          <div className="p-6 lg:overflow-y-auto">
            {video.platform === "podcast" ? (
              <AudioPlayer audioUrl={video.url} thumbnailUrl={proxyThumbnail(video.thumbnail_url)} title={video.title} showName={video.show_name} host={video.host} />
            ) : (
              <PublicVideoCover
                url={video.url}
                title={video.title}
                thumbnailUrl={proxyThumbnail(video.thumbnail_url, "full")}
              />
            )}
            <div className="mt-5 rounded-2xl border border-zinc-100 bg-white p-5">
              <p className="text-xs font-bold text-zinc-400 uppercase">热门品读</p>
              <h2 className="mt-2 text-xl font-black text-zinc-900 leading-snug">{stripMarkdown(video.title) || "无标题"}</h2>
              {video.description && <p className="mt-3 text-sm leading-7 text-zinc-500 line-clamp-4">{video.description}</p>}
              <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <p className="text-sm font-bold text-emerald-800">
                  {video.in_library ? "这个解析已在你的列表中" : "这是平台公开解析"}
                </p>
                <p className="mt-1 text-xs leading-5 text-emerald-700/80">
                  {video.in_library
                    ? "点击「进入解析」回到你的个人解析列表。收入知识库是独立动作，需要你确认后才会成为长期知识资产。"
                    : "加入我的解析后，它会保存到你的个人解析列表。收入知识库是独立动作，需要你确认后才会成为长期知识资产。"}
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={handleAddToLibrary}
                    disabled={addToLibraryMutation.isPending}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60",
                      video.in_library
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-zinc-900 hover:bg-zinc-700"
                    )}
                  >
                    {addToLibraryMutation.isPending
                      ? <CircleNotch size={15} weight="bold" className="animate-spin" />
                      : video.in_library
                        ? <ArrowSquareOut size={15} weight="bold" />
                        : <BookmarkSimple size={15} weight="bold" />}
                    {video.in_library ? "进入解析" : "加入我的解析"}
                  </button>
                  <button
                    onClick={handleAddToKnowledge}
                    disabled={addToLibraryMutation.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-60"
                  >
                    {addToLibraryMutation.isPending ? <CircleNotch size={15} weight="bold" className="animate-spin" /> : <Database size={15} weight="bold" />}
                    收入知识库
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-[520px] lg:min-h-0 lg:h-full border-l border-zinc-200 bg-white flex flex-col">
            <div className="flex border-b border-zinc-200 px-2 shrink-0 bg-zinc-50/50">
              {TABS.map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn("relative flex items-center gap-1.5 px-4 py-4 text-sm font-bold transition-colors", active ? "text-emerald-600" : "text-zinc-500 hover:text-zinc-900")}
                  >
                    <tab.icon size={14} weight="bold" />
                    {tab.label}
                    {active && <span className="absolute bottom-0 left-1 right-1 h-[3px] rounded-t-full bg-emerald-500" />}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {activeTab === "transcript" && <PublicTranscript segments={segments} />}
              {activeTab === "summary" && (
                <div className="p-5">
                  <div className="mb-4 flex flex-wrap gap-2">
                    {SUMMARY_ORDER.filter((level) => summaries.has(level)).map((level) => (
                      <button
                        key={level}
                        onClick={() => setActiveSummaryLevel(level)}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border", activeSummary?.level === level ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-white text-zinc-500 border-zinc-200 hover:bg-zinc-50")}
                      >
                        {SUMMARY_LABELS[level]}
                      </button>
                    ))}
                  </div>
                  {activeSummary ? (
                    <article className="prose prose-zinc max-w-none prose-headings:text-emerald-700">
                      <ReactMarkdown>{activeSummary.content}</ReactMarkdown>
                    </article>
                  ) : (
                    <EmptyState icon={ListBullets} text="暂无摘记" />
                  )}
                </div>
              )}
              {activeTab === "mindmap" && (
                data.mindmap?.markdown ? (
                  <PublicMindmapView markdown={data.mindmap.markdown} />
                ) : (
                  <EmptyState icon={TreeStructure} text="暂无脉络图" />
                )
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function PublicVideoCover({
  url,
  title,
  thumbnailUrl,
}: {
  url: string;
  title?: string | null;
  thumbnailUrl?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 shadow-md aspect-video">
      {thumbnailUrl && !imageFailed ? (
        <img
          src={thumbnailUrl}
          alt={title ?? "视频封面"}
          className="h-full w-full object-cover opacity-90"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="h-full w-full bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.24),transparent_36%),linear-gradient(135deg,#18181b,#27272a)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white/65">公开解析内容</p>
          <h2 className="mt-1 line-clamp-2 text-lg font-black leading-snug text-white">
            {stripMarkdown(title) || "热门品读"}
          </h2>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100"
        >
          <Play size={15} weight="fill" />
          打开原视频
          <ArrowSquareOut size={14} weight="bold" className="text-zinc-500" />
        </a>
      </div>
    </div>
  );
}

function PublicMindmapView({ markdown }: { markdown: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const renderMarkmap = useCallback(async () => {
    if (!containerRef.current || !svgRef.current) return;
    try {
      setLoadError(null);
      if (!Transformer) {
        const lib = await import("markmap-lib");
        Transformer = lib.Transformer;
      }
      if (!MarkmapView) {
        const view = await import("markmap-view");
        MarkmapView = view.Markmap;
      }

      const width = containerRef.current.offsetWidth || 720;
      const height = containerRef.current.offsetHeight || 560;
      svgRef.current.setAttribute("width", String(width));
      svgRef.current.setAttribute("height", String(height));

      if (mmRef.current) {
        try { mmRef.current.destroy(); } catch {}
        mmRef.current = null;
      }
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }

      const transformer = new Transformer();
      const { root } = transformer.transform(stripMindmapTimestamps(markdown));
      mmRef.current = MarkmapView.create(svgRef.current, {
        maxWidth: 300,
        paddingX: 16,
        spacingVertical: 8,
        spacingHorizontal: 80,
        autoFit: true,
        duration: 250,
        initialExpandLevel: 3,
        zoom: true,
      });
      mmRef.current.setData(root);
      setTimeout(() => mmRef.current?.fit(), 250);
    } catch (err) {
      console.error("Public mindmap render failed:", err);
      setLoadError(err instanceof Error ? err.message : "脉络图渲染失败");
    }
  }, [markdown]);

  useEffect(() => {
    renderMarkmap();
    return () => {
      if (mmRef.current) {
        try { mmRef.current.destroy(); } catch {}
        mmRef.current = null;
      }
    };
  }, [renderMarkmap]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !svgRef.current) return;
      svgRef.current.setAttribute("width", String(containerRef.current.offsetWidth || 720));
      svgRef.current.setAttribute("height", String(containerRef.current.offsetHeight || 560));
      mmRef.current?.fit();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  if (loadError) {
    return <EmptyState icon={TreeStructure} text={loadError} />;
  }

  return (
    <div ref={containerRef} className="h-full min-h-[520px] bg-white/60">
      <svg ref={svgRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}

function PublicTranscript({ segments }: { segments: TranscriptSegment[] }) {
  if (segments.length === 0) return <EmptyState icon={TextAlignLeft} text="暂无文字稿" />;
  return (
    <div className="p-3 space-y-1">
      {segments.map((segment, index) => (
        <div key={`${segment.start}-${index}`} className="flex gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:bg-zinc-50">
          <span className="shrink-0 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold h-fit mt-0.5 bg-blue-50 text-blue-500">
            {formatTime(segment.start)}
          </span>
          <p className="text-[13.5px] leading-[1.7] text-zinc-600">{segment.text}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof TextAlignLeft; text: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-zinc-400">
      <Icon size={32} weight="bold" className="text-zinc-300" />
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}
