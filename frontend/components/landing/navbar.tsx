"use client";

import Link from "next/link";
import { MagneticBtn } from "@/components/landing/shared";

interface NavbarProps {
  heroInView: boolean;
}

export function Navbar({ heroInView }: NavbarProps) {
  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
      heroInView ? "bg-transparent" : "bg-[#141418]/80 backdrop-blur-[50px] border-b border-white/[0.06]"
    }`}>
      <div className="max-w-[1512px] mx-auto px-[5%] flex items-center justify-between h-20">
        <Link href="/landing" className="flex items-center gap-[2px]">
          <img src="/logo.svg" alt="品猹" className="w-16 h-16" style={{ filter: "invert(1)" }} />
          <span className="font-bold text-[24px] leading-none tracking-[0.06em] text-white" style={{ fontFamily: "'LXGW WenKai TC', serif" }}>品猹</span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <Link href="/videos" className="text-[14px] text-white/60 hover:text-white transition-colors">内容整理</Link>
          <Link href="/knowledge" className="text-[14px] text-white/60 hover:text-white transition-colors">知识库</Link>
          <Link href="#features" onClick={(e) => { e.preventDefault(); document.querySelector("#features")?.scrollIntoView({ behavior: "smooth" }); }} className="text-[14px] text-white/60 hover:text-white transition-colors">如何品读</Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="px-4 py-2 text-[14px] text-white/50 hover:text-white rounded transition-colors">
            登录
          </Link>
          <MagneticBtn href="/login" className="px-4 py-2 text-[14px] font-medium bg-white text-[#141418] rounded hover:bg-zinc-200">
            开始品读
          </MagneticBtn>
        </div>
      </div>
    </nav>
  );
}
