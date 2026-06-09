"use client";

import { useRef, useEffect, useCallback } from "react";

interface CanvasGlowProps {
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
}

interface GlowOrb {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  radius: number;
  opacity: number;
  phase: number;
  speed: number;
}

const BRAND_COLOR = "#34d399";
const BG_COLOR = "#0a0a0a";
const PARTICLE_COUNT = 40;
const ORB_COUNT = 4;

function parseHex(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export function CanvasGlow({ className }: CanvasGlowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const orbsRef = useRef<GlowOrb[]>([]);
  const reducedMotionRef = useRef(false);
  const initParticles = useCallback((w: number, h: number) => {
    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      radius: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.5 + 0.1,
    }));
  }, []);

  const initOrbs = useCallback((w: number, h: number) => {
    const positions = [
      { bx: 0.3, by: 0.3 },
      { bx: 0.7, by: 0.25 },
      { bx: 0.5, by: 0.6 },
      { bx: 0.2, by: 0.7 },
    ];
    orbsRef.current = positions.slice(0, ORB_COUNT).map((p, i) => ({
      x: p.bx * w,
      y: p.by * h,
      baseX: p.bx * w,
      baseY: p.by * h,
      radius: Math.min(w, h) * (0.25 + i * 0.05),
      opacity: 0.08 + i * 0.02,
      phase: (i * Math.PI) / 2,
      speed: 0.0003 + i * 0.0001,
    }));
  }, []);
  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
    const [r, g, b] = parseHex(BRAND_COLOR);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Draw glow orbs
    for (const orb of orbsRef.current) {
      if (!reducedMotionRef.current) {
        orb.x = orb.baseX + Math.sin(time * orb.speed + orb.phase) * 60;
        orb.y = orb.baseY + Math.cos(time * orb.speed * 0.7 + orb.phase) * 40;
      }
      const gradient = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${orb.opacity})`);
      gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${orb.opacity * 0.4})`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(orb.x - orb.radius, orb.y - orb.radius, orb.radius * 2, orb.radius * 2);
    }

    // Draw particles
    for (const p of particlesRef.current) {
      if (!reducedMotionRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.opacity})`;
      ctx.fill();
    }
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mql.matches;
    const onMotionChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mql.addEventListener("change", onMotionChange);

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles(w, h);
      initOrbs(w, h);
    };

    resize();
    window.addEventListener("resize", resize);

    const loop = (time: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      draw(ctx, w, h, time);
      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", resize);
      mql.removeEventListener("change", onMotionChange);
    };
  }, [initParticles, initOrbs, draw]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
      aria-hidden="true"
    />
  );
}
