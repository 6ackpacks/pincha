"use client";

import { useMemo, useState, useEffect, useRef, Suspense, lazy } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Clock, ShareNetwork, CheckCircle, XCircle, CircleNotch, Trash } from "@phosphor-icons/react";
import { proxyThumbnail } from "@/lib/api/client";
import { VideoPlayer } from "@/components/video/video-player";
import { AudioPlayer } from "@/components/audio/audio-player";
import { TabPanel } from "@/components/video/tab-panel";
import ChapterBar from "@/components/video/chapter-bar";
import { useVideoSync } from "@/hooks/use-video-sync";
import { useVideoPageData } from "@/hooks/use-video-page-data";
import { useWikiCompile } from "@/hooks/use-wiki-compile";
import { parseDurationToSeconds, extractChapters } from "@/lib/video-utils";
import { Sidebar } from "@/components/layout/sidebar";
import { KBSelectDialog } from "@/components/knowledge/kb-select-dialog";
import { cn, stripMarkdown } from "@/lib/utils";
import { STATE_LABELS } from "@/lib/constants";
import { VideoPageSkeleton, VideoPageError, DeleteConfirmDialog, ShareCardDialog } from "./components";

// framer-motion blocks ~300ms of JS parse — only needed for flying-item animation
const FlyingItem = lazy(() => import("./flying-item").then((m) => ({ default: m.FlyingItem })));

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  podcast: "播客",
};

export default function VideoAnalysisPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const videoId = params.id;

  const {
    videoQuery, progressQuery, transcriptQuery, mindmapQuery,
    deleteMutation, reprocessMutation,
    video, progress, segments, segmentsEn,
    errorCountRef, pollCountRef, queryClient,
  } = useVideoPageData(videoId);

  const {
    wikiCompiling, addToWikiMutation,
    showKBDialog, setShowKBDialog,
    flyingItem, setFlyingItem,
  } = useWikiCompile(videoId, video);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showWikiPrompt, setShowWikiPrompt] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const prevStateRef = useRef<string | undefined>(undefined);

  // When processing finishes, refresh all dependent data
  useEffect(() => {
    if (progressQuery.data?.state === "done" || progressQuery.data?.state === "failed") {
      queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      queryClient.invalidateQueries({ queryKey: ["transcript", videoId] });
      queryClient.invalidateQueries({ queryKey: ["mindmap", videoId] });
    }
  }, [progressQuery.data?.state, queryClient, videoId]);

  // Show wiki prompt when video transitions from processing to done
  useEffect(() => {
    const state = progressQuery.data?.state;
    if (prevStateRef.current && prevStateRef.current !== "done" && state === "done" && !video?.in_wiki) {
      setShowWikiPrompt(true);
    }
    prevStateRef.current = state;
  }, [progressQuery.data?.state, video?.in_wiki]);

  useVideoSync(segments);

  const currentState = progress?.state ?? video?.status.state ?? "pending";
  const currentProgress = progress?.progress ?? video?.status.progress ?? 0;
  const isDone = currentState === "done";
  const isFailed = currentState === "failed";
  const isProcessing = !isDone && !isFailed;

  const videoDuration = parseDurationToSeconds(video?.duration);
  const chapters = useMemo(
    () => (mindmapQuery.data?.markdown ? extractChapters(mindmapQuery.data.markdown) : []),
    [mindmapQuery.data?.markdown]
  );

  if (videoQuery.isLoading) return <VideoPageSkeleton />;

  if (videoQuery.isError) {
    return <VideoPageError message={videoQuery.error.message} onBack={() => router.push("/videos")} />;
  }

  return (
    <div className="flex h-screen bg-[#FAFAFA] overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

      {/* Flying item animation — wiki ingest (lazy-loaded to unblock initial render) */}
      <Suspense fallback={null}>
        {flyingItem && (
          <FlyingItem keyName={flyingItem.key} onComplete={() => setFlyingItem(null)} />
        )}
      </Suspense>

      {/* Top Header */}
      <header className="sticky top-0 z-50 px-6 h-[60px] flex items-center gap-4 bg-white/80 backdrop-blur-md border-b border-zinc-200">
        <button onClick={() => router.push("/videos")} className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all">
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          返回
        </button>
        <div className="w-px h-5 bg-zinc-200 mx-2" />
        <h1 className="text-sm font-bold text-zinc-900 truncate flex-1">
          {stripMarkdown(video?.title || "") || "内容品读"}
        </h1>
        <div className="flex items-center gap-3">
          {video?.platform && (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200/60">
              <span className={cn("w-2 h-2 rounded-full", video.platform === "youtube" ? "bg-red-500" : video.platform === "podcast" ? "bg-purple-500" : "bg-sky-500")} />
              {PLATFORM_LABELS[video.platform] || video.platform}
            </span>
          )}
          {video?.duration && (
            <span className="flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200/60">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              {video.duration}
            </span>
          )}
          <span className={cn(
            "flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border",
            isDone && "bg-emerald-50 text-emerald-600 border-emerald-100",
            isFailed && "bg-red-50 text-red-600 border-red-100",
            isProcessing && "bg-amber-50 text-amber-600 border-amber-100"
          )}>
            {isDone ? <CheckCircle className="w-3.5 h-3.5" /> : isFailed ? <XCircle className="w-3.5 h-3.5" /> : <CircleNotch className="w-3.5 h-3.5 animate-spin" />}
            {STATE_LABELS[currentState] || currentState}
          </span>
        </div>
      </header>

      {/* Progress bar */}
      {isProcessing && (
        <div className="px-6 py-3 border-b border-zinc-200 bg-white shrink-0 shadow-sm flex items-center gap-4 relative z-10">
          <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${currentProgress}%` }}
            />
          </div>
          <span className="text-xs font-mono font-bold text-zinc-400 w-10 text-right">{currentProgress}%</span>
          <span className="text-xs font-bold text-emerald-600">{STATE_LABELS[currentState] || currentState}...</span>
        </div>
      )}

      {/* Progress fetch error banner */}
      {progressQuery.isError && errorCountRef.current >= 3 && (
        <div className="mx-6 mt-4 mb-2 p-3 rounded-xl bg-amber-50 border border-amber-100 shrink-0 flex items-center justify-between">
          <p className="text-xs font-bold text-amber-700">无法获取进度，请刷新页面</p>
          <button
            onClick={() => { errorCountRef.current = 0; pollCountRef.current = 0; queryClient.invalidateQueries({ queryKey: ["videoProgress", videoId] }); }}
            className="ml-4 shrink-0 px-3 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Error banner */}
      {isFailed && (
        <div className="mx-6 mt-4 mb-2 p-4 rounded-xl bg-red-50 border border-red-100 shrink-0">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-bold text-red-600 mb-1">整理遇到问题</p>
              <p className="text-xs text-red-500 font-medium break-all">
                {progress?.message || video?.status?.message || "未知错误，请确保视频链接可公开访问。"}
              </p>
            </div>
            <button
              onClick={() => reprocessMutation.mutate()}
              disabled={reprocessMutation.isPending}
              className="shrink-0 ml-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
            >
              {reprocessMutation.isPending ? <CircleNotch className="w-4 h-4 animate-spin" /> : null}
              {reprocessMutation.isPending ? "重试中" : "重新整理"}
            </button>
          </div>
        </div>
      )}

      {/* Wiki prompt banner */}
      <AnimatePresence>
        {showWikiPrompt && isDone && !video?.in_wiki && !wikiCompiling && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mx-6 mt-4 mb-2 p-4 rounded-xl bg-emerald-50 border border-emerald-100 shrink-0 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-emerald-700">内容已整理好</p>
              <p className="text-xs text-emerald-600 mt-0.5">收进知识库后，可以跨来源检索、关联与追问</p>
            </div>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <button onClick={() => setShowWikiPrompt(false)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">
                稍后
              </button>
              <button
                onClick={() => { setShowWikiPrompt(false); setShowKBDialog(true); }}
                disabled={addToWikiMutation.isPending}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors flex items-center gap-1.5"
              >
                <BookmarkSimple size={13} weight="bold" />
                收进知识库
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Two-column split view */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative z-0">
        {/* Left column — Video + Chapter (55%) */}
        <div className="w-full lg:w-[55%] flex flex-col gap-4 p-6 overflow-y-auto">
          {video?.platform === "podcast" ? (
            <div className="flex-shrink-0">
              <AudioPlayer audioUrl={video?.url || ""} thumbnailUrl={proxyThumbnail(video?.thumbnail_url)} title={video?.title} showName={video?.show_name} host={video?.host} />
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden shadow-md border border-zinc-200 bg-black aspect-video flex-shrink-0">
              <VideoPlayer url={video?.url || ""} title={video?.title} thumbnailUrl={proxyThumbnail(video?.thumbnail_url)} platform={video?.platform} />
            </div>
          )}

          {isDone && chapters.length > 0 && <ChapterBar chapters={chapters} videoDuration={videoDuration} />}

          {/* Action toolbar */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isDone && (
              video?.in_wiki ? (
                <button onClick={() => router.push("/knowledge")} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-sm hover:bg-emerald-100 transition-all">
                  <CheckCircle size={16} weight="bold" />
                  已在知识库
                </button>
              ) : wikiCompiling ? (
                <button disabled className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-white font-bold text-sm opacity-70 cursor-not-allowed">
                  <CircleNotch size={16} weight="bold" className="animate-spin" />
                  编译中…
                </button>
              ) : (
                <button
                  onClick={() => { setShowWikiPrompt(false); setShowKBDialog(true); }}
                  disabled={addToWikiMutation.isPending || wikiCompiling}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-600 shadow-sm hover:shadow transition-all disabled:opacity-50"
                >
                  {addToWikiMutation.isPending ? <CircleNotch size={16} weight="bold" className="animate-spin" /> : <BookmarkSimple size={16} weight="bold" />}
                  收进知识库
                </button>
              )
            )}
            {isDone && (
              <button onClick={() => setShowShareCard(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-zinc-200 text-zinc-600 font-medium text-sm hover:bg-zinc-50 hover:border-zinc-300 transition-all">
                <ShareNetwork size={15} weight="bold" />
                分享
              </button>
            )}
            <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-zinc-200 text-zinc-400 font-medium text-sm hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all">
              <Trash size={15} weight="bold" />
              删除
            </button>
          </div>
        </div>

        {/* Right column — Tab panel (45%) */}
        <div className="w-full lg:w-[45%] flex flex-col h-full border-l border-zinc-200 bg-white">
          <Suspense fallback={
            <div className="p-4 space-y-3 animate-pulse">
              <div className="flex gap-4 border-b pb-3">
                {["文字稿", "摘记", "脉络图", "追问"].map((t) => (
                  <div key={t} className="h-4 w-16 bg-zinc-100 rounded" />
                ))}
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 bg-zinc-100 rounded" style={{ width: `${85 - i * 5}%` }} />
              ))}
            </div>
          }>
            <TabPanel
              videoId={videoId}
              videoTitle={video?.title ?? undefined}
              thumbnail={video?.thumbnail_url ? (proxyThumbnail(video.thumbnail_url) ?? undefined) : undefined}
              segments={segments}
              segmentsEn={segmentsEn}
              isTranscriptLoading={transcriptQuery.isLoading}
              isDone={isDone}
              currentState={currentState}
            />
          </Suspense>
        </div>
      </main>
      </div>

      <DeleteConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} deleteMutation={deleteMutation} />
      {showShareCard && video && <ShareCardDialog open={showShareCard} onClose={() => setShowShareCard(false)} video={video} videoId={videoId} />}
      <KBSelectDialog open={showKBDialog} onOpenChange={setShowKBDialog} onConfirm={(kbId) => addToWikiMutation.mutate(kbId)} loading={addToWikiMutation.isPending} />
    </div>
  );
}
