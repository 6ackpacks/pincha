"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { currentTimeAtom, seekFnAtom } from "@/atoms/player";
import { Play, Pause, Headphones } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  audioUrl: string;
  thumbnailUrl?: string | null;
  title?: string | null;
  showName?: string | null;
  host?: string | null;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer({ audioUrl, thumbnailUrl, title, showName, host }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setSeekFn = useSetAtom(seekFnAtom);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rateIndex, setRateIndex] = useState(2); // default 1x
  const [isDragging, setIsDragging] = useState(false);

  // Release old audio decoder/buffer and set new src when audioUrl changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Release old decoder and buffer
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    // Set new src
    if (audioUrl) {
      audio.src = audioUrl;
      audio.load();
    }

    // Reset local state
    setPlaying(false);
    setLocalTime(0);
    setDuration(0);

    return () => {
      // Cleanup on unmount: release decoder/buffer
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [audioUrl]);

  // Register seek function to Jotai atom
  useEffect(() => {
    setSeekFn(() => (time: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = time;
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    });
    return () => {
      setSeekFn(null);
    };
  }, [setSeekFn]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      if (!isDragging) {
        setLocalTime(audio.currentTime);
        setCurrentTime(audio.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleEnded = () => setPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [isDragging, setCurrentTime]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const cycleRate = useCallback(() => {
    const nextIndex = (rateIndex + 1) % PLAYBACK_RATES.length;
    setRateIndex(nextIndex);
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = PLAYBACK_RATES[nextIndex];
    }
  }, [rateIndex]);

  // Seek on progress bar click/drag
  const seekToPosition = useCallback(
    (clientX: number) => {
      const bar = progressRef.current;
      const audio = audioRef.current;
      if (!bar || !audio || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = ratio * duration;
      audio.currentTime = time;
      setLocalTime(time);
      setCurrentTime(time);
    },
    [duration, setCurrentTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      seekToPosition(e.clientX);

      const handleMouseMove = (ev: MouseEvent) => {
        seekToPosition(ev.clientX);
      };
      const handleMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [seekToPosition]
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="w-full rounded-2xl overflow-hidden bg-white border border-zinc-200 shadow-sm">
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="metadata" />

      <div className="flex gap-5 p-5">
        {/* Cover image */}
        <div className="shrink-0 w-[120px] h-[120px] rounded-xl overflow-hidden bg-gradient-to-br from-emerald-100 to-teal-200 flex items-center justify-center">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title || "Podcast cover"}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling?.classList.remove("hidden");
              }}
            />
          ) : null}
          <Headphones
            size={40}
            className={cn("text-emerald-400/60", thumbnailUrl ? "hidden" : "")}
          />
        </div>

        {/* Right side: info + controls */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          {/* Metadata */}
          <div className="min-w-0">
            {showName && (
              <p className="text-xs font-medium text-emerald-600 truncate">{showName}</p>
            )}
            <h3 className="text-sm font-bold text-zinc-900 truncate mt-0.5">
              {title || "未知单集"}
            </h3>
            {host && (
              <p className="text-xs text-zinc-500 truncate mt-0.5">{host}</p>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div
              ref={progressRef}
              onMouseDown={handleMouseDown}
              className="relative w-full h-1.5 rounded-full bg-zinc-100 cursor-pointer group"
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-emerald-500 transition-[width] duration-75"
                style={{ width: `${progress}%` }}
              />
              {/* Drag handle */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 7px)` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] font-mono text-zinc-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-3 mt-1">
            {/* Play/Pause button */}
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors shadow-sm"
            >
              {playing ? <Pause size={18} weight="bold" /> : <Play size={18} weight="bold" className="ml-0.5" />}
            </button>

            {/* Speed control */}
            <button
              onClick={cycleRate}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 transition-colors"
            >
              {PLAYBACK_RATES[rateIndex]}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
