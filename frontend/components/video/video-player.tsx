"use client";

import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { currentTimeAtom, seekFnAtom } from "@/atoms/player";

interface VideoPlayerProps {
  url: string;
  title?: string | null;
  thumbnailUrl?: string | null;
  platform?: string;
}

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(url);
}

/**
 * Extract YouTube video ID from various URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://youtube.com/live/VIDEO_ID
 * - https://www.youtube.com/v/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extend window type for YouTube IFrame API
interface YTPlayerConfig {
  videoId: string | null;
  width?: string | number;
  height?: string | number;
  playerVars?: {
    autoplay?: number;
    rel?: number;
    modestbranding?: number;
    origin?: string;
    [key: string]: string | number | undefined;
  };
  events?: {
    onReady?: () => void;
    onError?: () => void;
    onStateChange?: (event: { data: number }) => void;
  };
}

interface YTPlayer {
  destroy(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        config: YTPlayerConfig
      ) => YTPlayer;
      PlayerState?: Record<string, number>;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiLoadPromise: Promise<void> | null = null;

/** Load the YouTube IFrame API script with a timeout. Resets on failure so retries are possible. */
function loadYouTubeIframeAPI(timeoutMs = 10000): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiLoadPromise) return ytApiLoadPromise;

  ytApiLoadPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("YouTube IFrame API load timed out"));
    }, timeoutMs);

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => {
      clearTimeout(timer);
      reject(new Error("YouTube IFrame API script failed to load"));
    };
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript.parentNode?.insertBefore(tag, firstScript);

    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve();
    };
  }).catch((err) => {
    // Reset so future calls can retry
    ytApiLoadPromise = null;
    throw err;
  });

  return ytApiLoadPromise;
}

export function VideoPlayer({
  url,
  title,
  thumbnailUrl,
  platform,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | { destroy(): void; currentTime: number; paused: boolean; play(): void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setSeekFn = useSetAtom(seekFnAtom);

  // Track whether YT API failed so we can show fallback iframe
  const [ytApiFailed, setYtApiFailed] = useState(false);

  const isDirect = isDirectVideoUrl(url);
  const youtubeId = platform === "youtube" ? extractYouTubeId(url) : null;

  // XGPlayer for direct video URLs
  useEffect(() => {
    if (!isDirect || !containerRef.current) return;

    let destroyed = false;

    async function initPlayer() {
      const { default: Player } = await import("xgplayer");

      if (destroyed || !containerRef.current) return;

      const player = new Player({
        el: containerRef.current,
        url,
        width: "100%",
        height: "100%",
        playbackRate: [0.5, 0.75, 1, 1.25, 1.5, 2],
        fluid: true,
        lang: "zh",
      });

      playerRef.current = player;

      player.on("timeupdate", () => {
        setCurrentTime(player.currentTime || 0);
      });

      setSeekFn(() => (time: number) => {
        player.currentTime = time;
        if (player.paused) {
          player.play();
        }
      });
    }

    initPlayer();

    return () => {
      destroyed = true;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setSeekFn(null);
    };
  }, [url, isDirect, setCurrentTime, setSeekFn]);

  // YouTube IFrame Player API — enables seek + time sync
  useEffect(() => {
    if (!youtubeId || ytApiFailed) return;

    // Create a fresh inner div for YT to replace (so containerRef stays stable)
    const host = ytHostRef.current;
    if (!host) return;
    const targetDiv = document.createElement("div");
    targetDiv.style.width = "100%";
    targetDiv.style.height = "100%";
    host.innerHTML = "";
    host.appendChild(targetDiv);

    let destroyed = false;

    async function initYTPlayer() {
      try {
        await loadYouTubeIframeAPI();
      } catch {
        if (!destroyed) setYtApiFailed(true);
        return;
      }
      if (destroyed) return;

      const player = new window.YT!.Player(targetDiv, {
        videoId: youtubeId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (destroyed) return;
            // Poll current time (YT API has no continuous timeupdate event)
            timerRef.current = setInterval(() => {
              if (!destroyed && player.getCurrentTime) {
                setCurrentTime(player.getCurrentTime());
              }
            }, 250);

            setSeekFn(() => (time: number) => {
              player.seekTo(time, true);
              if (
                player.getPlayerState &&
                player.getPlayerState() !== 1 /* PLAYING */
              ) {
                player.playVideo();
              }
            });
          },
          onError: () => {
            // If the player itself errors (e.g. video unavailable), keep showing it
            // — YT player displays its own error message in the iframe.
          },
        },
      });

      playerRef.current = player;
    }

    initYTPlayer();

    return () => {
      destroyed = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (playerRef.current?.destroy) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore — player may already be disposed
        }
        playerRef.current = null;
      }
      setSeekFn(null);
    };
  }, [youtubeId, ytApiFailed, setCurrentTime, setSeekFn]);

  // Fallback seek for unknown platform embeds
  useEffect(() => {
    if (isDirect || youtubeId) return;

    setSeekFn(() => (time: number) => {
      setCurrentTime(time);
    });

    return () => {
      setSeekFn(null);
    };
  }, [isDirect, youtubeId, setCurrentTime, setSeekFn]);

  // Direct video URL — render xgplayer container
  if (isDirect) {
    return (
      <div className="w-full rounded-lg overflow-hidden bg-black">
        <div ref={containerRef} className="w-full aspect-video" />
      </div>
    );
  }

  // YouTube — use YT IFrame API if available, otherwise fallback to plain iframe embed
  if (youtubeId) {
    if (ytApiFailed) {
      // Fallback: plain iframe embed (no seek/time-sync, but video plays)
      return (
        <div className="w-full rounded-lg overflow-hidden bg-black">
          <iframe
            className="aspect-video w-full"
            src={`https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            title={title || "YouTube video"}
          />
        </div>
      );
    }

    return (
      <div className="w-full rounded-lg overflow-hidden bg-black">
        <div className="aspect-video w-full">
          <div ref={ytHostRef} className="w-full h-full" />
        </div>
      </div>
    );
  }

  // Unknown platform fallback — open in original platform
  return (
    <div className="w-full rounded-lg overflow-hidden bg-muted">
      <div className="aspect-video relative flex flex-col items-center justify-center gap-3 p-4">
        {thumbnailUrl ? (
          <>
            <img
              src={thumbnailUrl}
              alt={title || "Video thumbnail"}
              loading="eager"
              fetchPriority="high"
              className="absolute inset-0 w-full h-full object-cover opacity-60"
            />
            <div className="relative z-10 flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-white ml-1"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <p className="text-sm text-white bg-black/50 rounded px-2 py-1">
                视频播放器
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-16 h-16 rounded-full bg-muted-foreground/20 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-muted-foreground ml-1"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">视频</p>
          </div>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 text-xs underline text-primary hover:text-primary/80"
        >
          在原平台观看
        </a>
      </div>
    </div>
  );
}
