"use client";

import Link from "next/link";
import { MagneticBtn } from "@/components/landing/shared";

interface NavbarProps {
  heroInView: boolean;
}

export function Navbar({ heroInView }: NavbarProps) {
  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 ${
      heroInView ? "bg-transparent" : "bg-white/78 backdrop-blur-[36px] border-b border-emerald-950/[0.08] shadow-[0_12px_40px_-32px_rgba(15,118,88,0.38)]"
    }`}>
      <div className="mx-auto grid h-20 max-w-[1512px] grid-cols-[auto_1fr_auto] items-center px-4 sm:px-[5%]">
        <Link href="/landing" prefetch={false} className="flex items-center">
          <img
            src="/brand/pincha-script.svg"
            alt="Pincha"
            width={220}
            height={72}
            loading="eager"
            decoding="sync"
            fetchPriority="high"
            className="h-16 w-[162px] shrink-0 -translate-x-3 object-contain object-left sm:h-[72px] sm:w-[220px] sm:-translate-x-6"
          />
        </Link>
        <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 items-center gap-10 md:flex">
          <Link href="/videos" prefetch={false} className="pointer-events-auto text-[15px] font-semibold text-[#0f1f17] hover:text-[#166534] transition-colors">内容整理</Link>
          <Link href="/knowledge" prefetch={false} className="pointer-events-auto text-[15px] font-semibold text-[#0f1f17] hover:text-[#166534] transition-colors">知识库</Link>
          <Link href="#features" prefetch={false} onClick={(e) => { e.preventDefault(); document.querySelector("#features")?.scrollIntoView({ behavior: "smooth" }); }} className="pointer-events-auto text-[15px] font-semibold text-[#0f1f17] hover:text-[#166534] transition-colors">如何品读</Link>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
          <Link href="/login" prefetch={false} className="whitespace-nowrap px-2 py-2 text-[15px] font-semibold text-[#0f1f17] hover:text-[#166534] rounded-full transition-colors sm:px-4">
            登录
          </Link>
          <MagneticBtn href="/login" className="whitespace-nowrap px-3 py-2 text-[14px] font-semibold bg-[#166534] text-white rounded-full hover:bg-[#14532d] shadow-[0_14px_30px_-22px_rgba(5,150,105,0.85)] sm:px-4">
            开始品读
          </MagneticBtn>
        </div>
      </div>
    </nav>
  );
}
