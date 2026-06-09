"use client";

import {
  RevealSection,
  FloatingImage,
  GlowOrb,
  AnimatedDivider,
} from "@/components/landing/shared";

export function FeaturesSection() {
  return (
    <>
      {/* ━━ Statement ━━ */}
      <section className="py-[20vh] px-[5%]">
        <RevealSection className="max-w-[980px] mx-auto text-center">
          <h2 className="text-[clamp(2.5rem,5.5vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-white">
            放入一段信息。
            <br />
            <span className="text-white/45">给它一个归处。</span>
          </h2>
        </RevealSection>
      </section>

      {/* ━━ Product Showcase ━━ */}
      <section className="px-[5%] pb-[15vh] relative overflow-hidden">
        <GlowOrb color="rgba(99,102,241,0.10)" size={500} className="top-[-100px] left-[-150px]" />
        <RevealSection className="max-w-[1200px] mx-auto">
          <div className="relative rounded-2xl overflow-hidden border border-white/[0.10]">
            <FloatingImage src="/demo-screenshot-1.png" alt="品猹首页界面" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#141418] via-[#141418]/30 via-[25%] to-transparent pointer-events-none" />
          </div>
          <p className="text-center text-white/30 text-sm mt-4">首页 — 放入内容即可开始品读</p>
        </RevealSection>
      </section>

      <AnimatedDivider className="max-w-[980px] mx-auto" />

      {/* ━━ Feature 1: 4 级摘要 ━━ */}
      <section id="features" className="py-[15vh] px-[5%] relative overflow-hidden">
        <GlowOrb color="rgba(168,85,247,0.08)" size={350} className="bottom-[-80px] right-[-100px]" />
        <div className="max-w-[980px] mx-auto">
          <RevealSection className="text-center mb-16">
            <p className="text-white/80 text-[14px] font-medium tracking-wide mb-5">提炼</p>
            <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-white mb-6">
              从冗长信息，
              <br />
              <span className="text-white/45">到清晰线索。</span>
            </h2>
            <p className="text-[19px] leading-[1.5] text-white/50 max-w-[520px] mx-auto">
              从快速浏览到逐段深读，品猹会按不同粒度整理信息，让你先抓住主干，再回到细节。
            </p>
          </RevealSection>
          <RevealSection delay={0.2}>
            <div className="relative rounded-2xl overflow-hidden border border-white/[0.10]">
              <FloatingImage src="/demo-screenshot-2.png" alt="4 级摘要界面" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141418]/40 via-transparent to-transparent pointer-events-none" />
            </div>
          </RevealSection>
        </div>
      </section>

      <AnimatedDivider className="max-w-[980px] mx-auto" />

      {/* ━━ Feature 2: 逐字稿 + 字幕同步 ━━ */}
      <section className="py-[15vh] px-[5%] relative overflow-hidden">
        <GlowOrb color="rgba(59,130,246,0.08)" size={380} className="top-[-60px] left-[-120px]" />
        <div className="max-w-[980px] mx-auto">
          <RevealSection className="text-center mb-16">
            <p className="text-white/80 text-[14px] font-medium tracking-wide mb-5">脉络</p>
            <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-white mb-6">
              每一条线索，
              <br />
              <span className="text-white/45">都回到原处。</span>
            </h2>
            <p className="text-[19px] leading-[1.5] text-white/50 max-w-[520px] mx-auto">
              字幕、时间轴、章节与脉络图相互对齐。你可以从结论回到原文，也可以从片段继续追问。
            </p>
          </RevealSection>
          <RevealSection delay={0.2}>
            <div className="relative rounded-2xl overflow-hidden border border-white/[0.10]">
              <FloatingImage src="/product-screenshot.png" alt="字幕同步界面" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141418]/40 via-transparent to-transparent pointer-events-none" />
            </div>
          </RevealSection>
        </div>
      </section>

      <AnimatedDivider className="max-w-[980px] mx-auto" />

      {/* ━━ Feature 3: 知识库 ━━ */}
      <section className="py-[15vh] px-[5%]">
        <div className="max-w-[980px] mx-auto text-center">
          <RevealSection>
            <p className="text-white/80 text-[14px] font-medium tracking-wide mb-5">知识库</p>
            <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-white mb-6">
              留下来的信息，
              <br />
              <span className="text-white/45">都有自己的归处。</span>
            </h2>
            <p className="text-[19px] leading-[1.5] text-white/50 max-w-[560px] mx-auto">
              视频、播客与文章会逐步汇入个人知识库。跨内容检索、关联发现、持续追问，让重要信息不再散落。
            </p>
          </RevealSection>
        </div>
      </section>

      {/* ━━ Platforms ━━ */}
      <section className="py-[15vh] px-[5%]">
        <AnimatedDivider className="max-w-[980px] mx-auto mb-[15vh]" />
        <div className="max-w-[980px] mx-auto">
          <RevealSection className="text-center">
            <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-white mb-6">
              视频、播客、文章。
              <br />
              <span className="text-white/45">都可以被重新整理。</span>
            </h2>
            <p className="text-[19px] leading-[1.5] text-white/50 max-w-[480px] mx-auto">
              从长视频到深度文章，从播客到每日线索，品猹把信息流整理成你的学习路径。
            </p>
          </RevealSection>
        </div>
      </section>
    </>
  );
}
