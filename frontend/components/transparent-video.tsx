"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";

export interface TransparentVideoHandle {
  play: () => void;
  pause: () => void;
  reset: () => void;
}

interface Props {
  src: string;
  loop?: boolean;
  style?: React.CSSProperties;
  onEnded?: () => void;
  threshold?: number;
}

export const TransparentVideo = forwardRef<TransparentVideoHandle, Props>(
  function TransparentVideo({ src, loop, style, onEnded, threshold = 40 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const rafRef = useRef<number>(0);
    const playingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      play() {
        const v = videoRef.current;
        if (!v) return;
        playingRef.current = true;
        v.play().catch(() => {});
        tick();
      },
      pause() {
        playingRef.current = false;
        videoRef.current?.pause();
        cancelAnimationFrame(rafRef.current);
      },
      reset() {
        if (videoRef.current) videoRef.current.currentTime = 0;
      },
    }));

    useEffect(() => {
      const video = document.createElement("video");
      video.src = src;
      video.crossOrigin = "anonymous";
      video.loop = !!loop;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      if (onEnded) {
        video.addEventListener("ended", onEnded);
      }
      videoRef.current = video;

      return () => {
        playingRef.current = false;
        cancelAnimationFrame(rafRef.current);
        video.pause();
        video.src = "";
        if (onEnded) video.removeEventListener("ended", onEnded);
      };
    }, [src, loop, onEnded]);

    function tick() {
      if (!playingRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.paused || video.ended) return;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      ctx.drawImage(video, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = frame.data;
      const t = threshold;

      for (let i = 0; i < d.length; i += 4) {
        const maxCh = Math.max(d[i], d[i + 1], d[i + 2]);
        if (maxCh < t) {
          d[i + 3] = 0;
        } else if (maxCh < t + 10) {
          d[i + 3] = Math.round(((maxCh - t) / 10) * d[i + 3]);
        }
      }

      ctx.putImageData(frame, 0, 0);
      rafRef.current = requestAnimationFrame(tick);
    }

    return (
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          ...style,
        }}
      />
    );
  }
);
