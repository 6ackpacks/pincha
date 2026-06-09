"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { RevealSection, MagneticBtn } from "@/components/landing/shared";

export function CtaSection() {
  return (
    <section className="py-[20vh] px-[5%]">
      <RevealSection className="text-center">
        <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-white mb-8">
          开始品读。
        </h2>
        <div className="flex items-center justify-center gap-6">
          <MagneticBtn href="/login" className="px-6 py-3 text-[14px] font-medium bg-white text-[#141418] rounded hover:bg-zinc-200 gap-2">
            免费开始 <ArrowRight size={14} weight="bold" />
          </MagneticBtn>
          <Link href="#features" onClick={(e) => { e.preventDefault(); document.querySelector("#features")?.scrollIntoView({ behavior: "smooth" }); }} className="text-[14px] text-white/80 hover:text-white/60 transition-colors inline-flex items-center gap-1">
            了解更多 <ArrowRight size={14} weight="bold" />
          </Link>
        </div>
      </RevealSection>
    </section>
  );
}
