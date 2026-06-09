"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useMotionValue, useSpring, useInView } from "framer-motion";
import { ArrowRight, Play } from "@phosphor-icons/react";

/* ── Animation config ── */
const power2Out = [0.33, 1, 0.68, 1] as const;

const fadeBlur = {
  hidden: { y: 24, opacity: 0, filter: "blur(10px)" },
  visible: (d: number) => ({
    y: 0, opacity: 1, filter: "blur(0px)",
    transition: { duration: 1, ease: power2Out, delay: d },
  }),
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.2 } },
};

/* ── Magnetic Button ── */
export function MagneticBtn({ children, className, href }: { children: React.ReactNode; className?: string; href: string }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 150, damping: 15 });
  const sy = useSpring(y, { stiffness: 150, damping: 15 });
  const ref = useRef<HTMLAnchorElement>(null);
  return (
    <Link href={href} ref={ref}
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

/* ── Scroll-triggered section wrapper ── */
export function RevealSection({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial="hidden" animate={inView ? "visible" : "hidden"}
      variants={fadeBlur} custom={delay} className={`will-change-[filter,transform] ${className ?? ""}`}>
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
    <motion.div
      className={`h-[1px] w-full ${className ?? ""}`}
      style={{ backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), rgba(255,255,255,0.3), rgba(255,255,255,0.15), transparent)" }}
      animate={{ backgroundPosition: ["200% 0%", "-200% 0%"] }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
    />
  );
}

/* ── Hero Section ── */
interface LandingHeroSectionProps {
  heroRef: React.RefObject<HTMLElement | null>;
}

export function LandingHeroSection({ heroRef }: LandingHeroSectionProps) {
  return (
    <section ref={heroRef} className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden">
      <video autoPlay muted loop playsInline aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        poster="/hero-clips/clip-1.jpg">
        <source src="/hero-clips/hero-loop.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-b from-[#141418]/70 via-[#141418]/50 to-[#141418]" />

      <motion.div initial="hidden" animate="visible" variants={staggerContainer}
        className="relative z-10 flex flex-col items-center text-center px-[5%] pt-20">
        <motion.p variants={fadeBlur} custom={0}
          className="text-xs uppercase tracking-[0.15em] text-white/45 mb-6">
          AI Knowledge Workspace
        </motion.p>
        <motion.h1 variants={fadeBlur} custom={0.2}
          className="max-w-[900px] text-[clamp(3rem,8vw,6.5rem)] font-normal leading-[0.9] tracking-[-0.03em]"
          style={{ textShadow: "0 0 1px rgba(255,255,255,0.3)" }}>
          Where Content
          <br />
          <span className="text-white/80">Becomes Knowledge</span>
        </motion.h1>
        <motion.p variants={fadeBlur} custom={0.4}
          className="mt-8 text-[16px] leading-relaxed text-white/50 max-w-[480px]">
          让信息有归处。品猹整理视频、播客、文章与每日线索，并汇入可检索、可追问的个人知识库。
        </motion.p>
        <motion.div variants={fadeBlur} custom={0.6} className="mt-10 flex items-center gap-4">
          <MagneticBtn href="/login" className="px-6 py-3 text-[14px] font-medium bg-white text-[#141418] rounded hover:bg-zinc-200 gap-2">
            开始品读 <ArrowRight size={14} weight="bold" />
          </MagneticBtn>
          <MagneticBtn href="#features" className="px-6 py-3 text-[14px] font-medium bg-transparent text-white border border-white/20 rounded hover:border-white/40 gap-2">
            <Play size={14} weight="bold" /> 看看如何工作
          </MagneticBtn>
        </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/25">Scroll</span>
        <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.5, repeat: Infinity }}
          className="w-[1px] h-6 bg-gradient-to-b from-white/30 to-transparent" />
      </motion.div>
    </section>
  );
}
