"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useMotionValue, useSpring, useInView } from "framer-motion";
import { ArrowRight, Play } from "@phosphor-icons/react";

/* ── Animation config ── */
const power2Out = [0.33, 1, 0.68, 1] as const;
const HERO_POSTER_SRC = "/hero-clips/hero-poster-720.webp";
const HERO_STANDARD_VIDEO_SOURCES = [
  { src: "/hero-clips/hero-loop.webm", type: "video/webm" },
  { src: "/hero-clips/hero-loop.mp4", type: "video/mp4" },
] as const;
const HERO_HIGH_VIDEO_SOURCES = [
  { src: "/hero-clips/hero-loop-720.mp4", type: "video/mp4" },
] as const;
const HERO_VIDEO_START_DELAY_MS = 1800;
const HERO_MEDIA_CLASS = "absolute inset-0 h-full w-full object-cover";
const HERO_MEDIA_STYLE = {
  objectPosition: "center 52%",
  transform: "scale(1.08)",
} as const;

type HeroVideoSource = {
  src: string;
  type: string;
};

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformation;
}

const fadeBlur = {
  hidden: { y: 24, opacity: 0 },
  visible: (d: number) => ({
    y: 0, opacity: 1,
    transition: { duration: 1, ease: power2Out, delay: d },
  }),
};

/* ── Magnetic Button ── */
export function MagneticBtn({ children, className, href }: { children: React.ReactNode; className?: string; href: string }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 150, damping: 15 });
  const sy = useSpring(y, { stiffness: 150, damping: 15 });
  const ref = useRef<HTMLAnchorElement>(null);
  return (
    <Link href={href} ref={ref} prefetch={false}
      onClick={(e) => { if (href.startsWith("#")) { e.preventDefault(); document.querySelector(href)?.scrollIntoView({ behavior: "smooth" }); } }}
      onMouseMove={(e) => { const rect = ref.current?.getBoundingClientRect(); if (!rect) return; x.set((e.clientX - rect.left - rect.width / 2) * 0.15); y.set((e.clientY - rect.top - rect.height / 2) * 0.15); }}
      onMouseLeave={() => { x.set(0); y.set(0); }}>
      <motion.span style={{ x: sx, y: sy }}
        className={`inline-flex items-center ${className} active:scale-[0.97] transition-[background-color,box-shadow] duration-150`}>
        {children}
      </motion.span>
    </Link>
  );
}

function LandingHeroMedia() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [videoSources, setVideoSources] = useState<readonly HeroVideoSource[]>([]);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    if (!posterLoaded) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const connection = (navigator as NavigatorWithConnection).connection;
    const isConstrainedNetwork = connection?.saveData === true || /(^|-)2g$/.test(connection?.effectiveType ?? "");

    if (prefersReducedMotion || isConstrainedNetwork) return;

    const load = () => {
      const prefersHighQuality =
        window.matchMedia("(min-width: 520px)").matches;

      setVideoSources(prefersHighQuality ? HERO_HIGH_VIDEO_SOURCES : HERO_STANDARD_VIDEO_SOURCES);
    };

    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;

      load();
    }, HERO_VIDEO_START_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [posterLoaded]);

  useEffect(() => {
    if (videoSources.length === 0) return;

    window.requestAnimationFrame(() => {
      videoRef.current?.load();
    });
  }, [videoSources]);

  return (
    <>
      <Image
        src={HERO_POSTER_SRC}
        alt=""
        aria-hidden="true"
        fill
        priority
        unoptimized
        fetchPriority="high"
        sizes="100vw"
        className={HERO_MEDIA_CLASS}
        style={HERO_MEDIA_STYLE}
        onLoad={() => setPosterLoaded(true)}
      />
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="none"
        poster={HERO_POSTER_SRC}
        aria-hidden="true"
        onCanPlay={() => setVideoReady(true)}
        className={`${HERO_MEDIA_CLASS} transition-opacity duration-700 ${
          videoReady ? "opacity-100" : "opacity-0"
        }`}
        style={HERO_MEDIA_STYLE}
      >
        {videoSources.length > 0 &&
          videoSources.map((source) => (
            <source
              key={source.src}
              src={source.src}
              type={source.type}
            />
          ))}
      </video>
      {!videoReady && (
        <noscript>
          <img
            src={HERO_POSTER_SRC}
            alt=""
            aria-hidden="true"
            className={HERO_MEDIA_CLASS}
            style={HERO_MEDIA_STYLE}
          />
        </noscript>
      )}
    </>
  );
}

/* ── Scroll-triggered section wrapper ── */
export function RevealSection({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial="hidden" animate={inView ? "visible" : "hidden"}
      variants={fadeBlur} custom={delay} className={`will-change-transform ${className ?? ""}`}>
      {children}
    </motion.div>
  );
}

/* ── Floating Image ── */
export function FloatingImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <motion.img
      src={src}
      alt={alt}
      className={`will-change-transform w-full ${className ?? ""}`}
      animate={{ y: [0, -8, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/* ── Glow Orb ── */
export function GlowOrb({ color = "rgba(99,102,241,0.12)", size = 400, className }: { color?: string; size?: number; className?: string }) {
  return (
    <motion.div
      className={`absolute rounded-full pointer-events-none will-change-transform ${className ?? ""}`}
      style={{ width: size, height: size, background: `radial-gradient(circle, ${color} 0%, transparent 70%)`, filter: "blur(60px)" }}
      animate={{ x: [0, 30, -20, 0], y: [0, -20, 15, 0], scale: [1, 1.05, 0.95, 1] }}
      transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/* ── Animated Divider ── */
export function AnimatedDivider({ className }: { className?: string }) {
  return (
    <div className={`h-[1px] w-full overflow-hidden ${className ?? ""}`}>
      <motion.div
        className="h-full w-[200%] will-change-transform"
        style={{ backgroundImage: "linear-gradient(90deg, transparent, rgba(20,184,116,0.18), rgba(20,184,116,0.34), rgba(20,184,116,0.18), transparent)" }}
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}

/* ── Browser Frame ── */
export function BrowserFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-xl border border-white/[0.08] bg-[#0a0a0d] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5),0_0_80px_-20px_rgba(52,211,153,0.08)] overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.06]">
        <div className="w-2.5 h-2.5 rounded-full bg-white/[0.12]" />
        <div className="w-2.5 h-2.5 rounded-full bg-white/[0.12]" />
        <div className="w-2.5 h-2.5 rounded-full bg-white/[0.12]" />
        <div className="ml-3 flex-1 h-5 rounded-md bg-white/[0.04] max-w-[280px]" />
      </div>
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

/* ── Hero Section ── */
interface LandingHeroSectionProps {
  heroRef: React.RefObject<HTMLElement | null>;
}

export function LandingHeroSection({ heroRef }: LandingHeroSectionProps) {
  return (
    <section ref={heroRef} className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden">
      <LandingHeroMedia />
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-white/[0.12] to-[#f7fbf7]/45" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.04),rgba(247,251,247,0.22)_76%)]" />

      <div className="relative z-10 flex flex-col items-center px-[5%] pt-16 text-center sm:pt-20">
        <p className="mb-6 inline-flex animate-[landingHeroIn_520ms_ease-out_80ms_both] items-center rounded-full border border-emerald-950/10 bg-white/82 px-3.5 py-1.5 text-[12px] font-semibold text-[#0f1f17] shadow-[0_10px_30px_-22px_rgba(0,0,0,0.55)] backdrop-blur-md sm:mb-7">
          Video · Podcast · Article → Knowledge
        </p>
        <h1
          className="max-w-[1120px] animate-[landingHeroIn_580ms_ease-out_160ms_both] text-[clamp(2.75rem,5.2vw,5.75rem)] leading-[1.03] tracking-[-0.02em] text-[#0f1f17]"
          style={{ fontFamily: "var(--font-instrument-serif), Georgia, serif" }}>
          Watch Less. <span className="text-[#0f1f17] italic">Know More.</span>
        </h1>
        <div
          className="mt-6 max-w-[720px] animate-[landingHeroIn_580ms_ease-out_240ms_both] rounded-[30px] bg-white/46 px-5 py-4 text-center text-[#0f1f17] shadow-[0_18px_48px_-42px_rgba(15,23,42,0.65)] backdrop-blur-[2px] sm:px-7"
          style={{ fontFamily: "STKaiti, KaiTi, Kaiti SC, Songti SC, serif" }}>
          <p className="text-[clamp(1rem,1.35vw,1.35rem)] font-semibold leading-[1.35]">
            让信息有归处
          </p>
          <p className="mt-2 text-[clamp(0.88rem,1vw,1.05rem)] leading-[1.75] text-[#24382f]/82">
            整理视频、播客、文章与每日线索，汇入所有的个人知识库。
          </p>
        </div>
        <div className="mt-8 flex animate-[landingHeroIn_580ms_ease-out_320ms_both] flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <MagneticBtn href="/login" className="px-6 py-3 text-[14px] font-semibold bg-[#166534] text-white rounded-full hover:bg-[#14532d] hover:shadow-[0_18px_40px_-24px_rgba(5,150,105,0.75)] gap-2 transition-all duration-200">
            开始品读 <ArrowRight size={14} weight="bold" />
          </MagneticBtn>
          <MagneticBtn href="#features" className="px-6 py-3 text-[14px] font-semibold bg-white/78 text-[#0f1f17] border border-emerald-950/10 rounded-full hover:border-[#166534]/25 hover:bg-white gap-2 transition-all duration-200">
            <Play size={14} weight="bold" /> 看看如何工作
          </MagneticBtn>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 animate-[landingHeroFade_600ms_ease-out_900ms_both] flex-col items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.2em] text-[#0f1f17]/45">Scroll</span>
        <div className="h-6 w-[1px] animate-[landingScrollHint_1.5s_ease-in-out_infinite] bg-gradient-to-b from-[#0f1f17]/35 to-transparent" />
      </div>
    </section>
  );
}
