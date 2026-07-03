"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { RevealSection, MagneticBtn } from "@/components/landing/shared";

export function CtaSection() {
  return (
    <section className="relative overflow-hidden py-[16vh] px-[5%] bg-[#fbfaf5]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(16,35,28,0.034)_1px,transparent_1px),linear-gradient(90deg,rgba(16,35,28,0.034)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <RevealSection className="relative text-center">
        <h2
          className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-[#10231c] mb-10"
          style={{ fontFamily: "var(--font-instrument-serif), serif" }}
        >
          开始品读。
        </h2>
        <MagneticBtn href="/login" className="px-8 py-3.5 text-[14px] font-medium bg-emerald-600 text-white rounded-full hover:bg-emerald-700 hover:shadow-[0_18px_40px_-24px_rgba(5,150,105,0.75)] gap-2 transition-all duration-200">
          免费开始 <ArrowRight size={14} weight="bold" />
        </MagneticBtn>
      </RevealSection>
    </section>
  );
}
