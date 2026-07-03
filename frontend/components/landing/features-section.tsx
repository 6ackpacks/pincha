"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  LinkSimple,
  Brain,
  Network,
} from "@phosphor-icons/react";
import {
  RevealSection,
  GlowOrb,
} from "@/components/landing/shared";
import { cdnUrl } from "@/lib/cdn";

const KnowledgePulseFlow = dynamic(
  () => import("./knowledge-pulse-flow").then((m) => m.KnowledgePulseFlow),
  { ssr: false }
);

const pipelineSteps = [
  {
    icon: LinkSimple,
    label: "内容进入",
    desc: "视频、播客、文章与每日线索",
  },
  {
    icon: Brain,
    label: "生成解析",
    desc: "概要 · 层级总结 · 字幕对齐",
  },
  {
    icon: Network,
    label: "知识沉淀",
    desc: "图谱 · 检索 · 长期复用",
  },
];

const outputTabs = [
  {
    id: "graph",
    label: "知识图谱",
    title: "看见内容之间的关系",
    desc: "视频、播客、文章与每日线索会沉淀成节点和连接，帮助你从单条内容跳到相关概念、人物和论点。",
    points: ["自动整理关键词", "连接相似主题", "从图谱回到原文"],
    image: cdnUrl("/landing/3d/mascot-knowledge-graph-v1.png"),
    aspect: "aspect-[16/9]",
  },
  {
    id: "library",
    label: "知识库",
    title: "把看过的内容长期保存",
    desc: "每次整理、总结和追问都会进入个人知识库，不再散落在收藏夹、历史记录和聊天窗口里。",
    points: ["按主题归档", "保留来源上下文", "随时继续追问"],
    image: cdnUrl("/landing/3d/mascot-knowledge-v1.png"),
    aspect: "aspect-[16/9]",
  },
  {
    id: "search",
    label: "关联检索",
    title: "用问题找回相关知识",
    desc: "输入一个问题，品猹会从你的知识库里找出相关内容、来源和线索，让答案有出处。",
    points: ["关联多个来源", "回答绑定证据", "从答案跳回内容"],
    image: cdnUrl("/landing/3d/3d-associative-search-v2.png"),
    aspect: "aspect-[1672/941]",
  },
];

const curateImages = [
  {
    title: "订阅推送",
    desc: "订阅你关心的频道，每天自动收到值得细读的线索。",
    image: cdnUrl("/landing/curate/curate-subscribe-v2.png"),
    className: "mx-auto w-full max-w-[920px] lg:col-span-12",
    aspect: "aspect-[4/3] sm:aspect-[16/10] lg:aspect-[2172/724]",
  },
];

const curateChannels = [
  "AI 产品上新",
  "AI 使用教程",
  "AI 产品洞察",
  "AI 深度阅读",
  "AI 每日简报",
];

function ProductImage({
  src,
  alt,
  className,
  imageClassName,
  aspectRatio = "16 / 10",
}: {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  aspectRatio?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-emerald-950/[0.08] bg-white shadow-[0_28px_90px_-48px_rgba(16,185,129,0.42),0_18px_70px_-48px_rgba(15,23,42,0.34)] ${className ?? ""}`}
      style={{ aspectRatio }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 768px) 100vw, 720px"
        className={`${imageClassName ?? "object-cover"}`}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_38%,rgba(16,185,129,0.10))]" />
    </div>
  );
}

export function FeaturesSection() {
  const [activeTab, setActiveTab] = useState("graph");
  const activeOutput = outputTabs.find((tab) => tab.id === activeTab) ?? outputTabs[0];

  return (
    <div className="relative overflow-hidden bg-[#fbfaf5]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(16,35,28,0.034)_1px,transparent_1px),linear-gradient(90deg,rgba(16,35,28,0.034)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-[#f7fbf7] via-[#fbfaf5]/92 to-transparent" />

      <section className="relative px-[5%] py-[16vh]">
        <RevealSection className="mx-auto max-w-[980px] text-center">
          <h2
            className="text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[1.1] tracking-[-0.02em] text-[#10231c]"
            style={{ fontFamily: "var(--font-instrument-serif), serif" }}
          >
            放入一段信息。
            <br />
            <span className="text-[#0f1f17] italic">给它一个归处。</span>
          </h2>
        </RevealSection>
      </section>

      <section className="relative px-[5%] pb-[10vh]">
        <RevealSection className="mx-auto max-w-[900px]">
          <div className="relative grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-0">
            <div className="absolute left-[20%] right-[20%] top-8 hidden h-px bg-gradient-to-r from-emerald-700/0 via-emerald-700/22 to-emerald-700/0 md:block" />

            {pipelineSteps.map((step) => (
              <div key={step.label} className="relative z-10 flex flex-col items-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-950/[0.08] bg-white shadow-[0_18px_42px_-32px_rgba(16,185,129,0.55)]">
                  <step.icon size={24} weight="light" className="text-emerald-700" />
                </div>
                <h3 className="mb-1 text-[15px] font-medium text-[#10231c]">{step.label}</h3>
                <p className="text-[13px] text-[#2d4a3a]/80">{step.desc}</p>
              </div>
            ))}
          </div>
        </RevealSection>
      </section>

      <section id="features" className="relative overflow-hidden px-[5%] py-16 md:py-20 lg:py-24">
        <GlowOrb color="rgba(16,185,129,0.13)" size={450} className="right-[-150px] top-[-80px]" />
        <div className="mx-auto max-w-[1180px]">
          <RevealSection className="mb-8 text-center">
            <span className="mb-6 inline-flex items-center rounded-full border border-emerald-700/10 bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-700">
              第一步
            </span>
            <h2
              className="text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-[#10231c]"
              style={{ fontFamily: "var(--font-instrument-serif), serif" }}
            >
              每天筛出值得细读的内容线索，
              <br />
              <span className="text-[#0f1f17] italic">五个频道，订阅后自动更新。</span>
            </h2>
            <p className="mx-auto mt-5 max-w-[640px] text-[17px] leading-[1.7] text-[#2d4a3a]">
              猹选覆盖产品动态、使用教程、产品洞察、深度阅读和每日简报，把当天最值得看的内容先替你挑出来。
            </p>
            <div className="mx-auto mt-6 flex max-w-[820px] flex-wrap items-center justify-center gap-2">
              {curateChannels.map((channel) => (
                <span
                  key={channel}
                  className="rounded-full border border-emerald-700/10 bg-white/78 px-3.5 py-1.5 text-[12px] font-medium text-[#2d4a3a] shadow-[0_12px_30px_-26px_rgba(15,118,88,0.34)]"
                >
                  {channel}
                </span>
              ))}
            </div>
          </RevealSection>
          <RevealSection delay={0.15}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {curateImages.map((item) => (
                <article
                  key={item.title}
                  className={`overflow-hidden rounded-[28px] border border-[#e9decf] bg-white/82 p-3 shadow-[0_22px_70px_-58px_rgba(83,64,35,0.48)] ${item.className}`}
                >
                  <div
                    className={`relative overflow-hidden rounded-[22px] border border-emerald-950/[0.06] bg-white ${item.aspect}`}
                  >
                    <Image
                      src={item.image}
                      alt={item.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 920px"
                      className="object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.10),transparent_42%,rgba(16,185,129,0.06))]" />
                  </div>
                  <div className="flex flex-col gap-3 px-2 pb-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[16px] font-semibold text-[#10231c]">{item.title}</p>
                      <p className="mt-1 text-[13px] leading-6 text-[#597064]">{item.desc}</p>
                    </div>
                    {item.title === "订阅推送" && (
                      <Link
                        href="/curate"
                        prefetch={false}
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-emerald-700 px-4 text-[13px] font-semibold text-white shadow-[0_18px_36px_-28px_rgba(5,150,105,0.9)] transition hover:bg-emerald-800"
                      >
                        订阅猹选
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="relative overflow-hidden px-[5%] py-16 md:py-20 lg:py-24">
        <GlowOrb color="rgba(16,185,129,0.10)" size={380} className="left-[-120px] top-[-60px]" />
        <div className="mx-auto max-w-[1180px]">
          <RevealSection className="mx-auto max-w-[760px] space-y-5 text-center" delay={0.1}>
            <span className="inline-flex items-center rounded-full border border-emerald-700/10 bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-700">
              第二步
            </span>
            <h2
              className="text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-[#10231c]"
              style={{ fontFamily: "var(--font-instrument-serif), serif" }}
            >
              知识生成解析，
              <br />
              <span className="text-[#0f1f17] italic">短时间读完一条长内容。</span>
            </h2>
            <p className="mx-auto max-w-[650px] text-[17px] leading-[1.7] text-[#2d4a3a]">
              品猹会把一条长视频拆成可以阅读、检索和追问的结构化知识：先理解全局，再逐层展开，最后回到原句和时间点。
            </p>
          </RevealSection>

          <RevealSection delay={0.18} className="mt-10">
            <KnowledgePulseFlow />
          </RevealSection>
        </div>
      </section>

      <section className="relative overflow-hidden px-[5%] py-16 md:py-24 lg:py-28">
        <GlowOrb color="rgba(16,185,129,0.12)" size={400} className="bottom-[-100px] right-[-80px]" />
        <div className="mx-auto max-w-[1080px]">
          <RevealSection className="mb-10 text-center">
            <span className="mb-6 inline-flex items-center rounded-full border border-emerald-700/10 bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-700">
              第三步
            </span>
            <h2
              className="text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-[#10231c]"
              style={{ fontFamily: "var(--font-instrument-serif), serif" }}
            >
              沉淀到知识库，
              <br />
              <span className="text-[#0f1f17] italic">之后随时检索与复用。</span>
            </h2>
            <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-[1.7] text-[#2d4a3a]">
              看过的视频、播客、文章和每日线索，会沉淀为可检索、可关联、可追问的个人知识库。品猹帮你保留内容之间的关系，而不是只留下一份摘要。
            </p>
          </RevealSection>

          <RevealSection delay={0.15}>
            <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
              {outputTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-4 py-2 text-[13px] font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? "border border-emerald-700/20 bg-emerald-600 text-white shadow-[0_14px_30px_-24px_rgba(5,150,105,0.85)]"
                      : "border border-emerald-950/[0.06] bg-white/70 text-[#2d4a3a] hover:text-emerald-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid items-center gap-6 rounded-[34px] border border-[#e9decf] bg-white/72 p-4 shadow-[0_26px_80px_-58px_rgba(83,64,35,0.42)] md:p-6 lg:grid-cols-[0.38fr_0.62fr] lg:p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activeTab}-copy`}
                  className="order-2 rounded-[26px] border border-[#eadfce] bg-[#fffdf8]/86 p-5 lg:order-1 lg:p-6"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.24 }}
                >
                  <p className="text-[13px] font-semibold text-emerald-700">{activeOutput.label}</p>
                  <h3 className="mt-3 text-[24px] font-semibold leading-tight text-[#10231c]">
                    {activeOutput.title}
                  </h3>
                  <p className="mt-4 text-[15px] leading-7 text-[#496456]">{activeOutput.desc}</p>
                  <div className="mt-6 space-y-3">
                    {activeOutput.points.map((point) => (
                      <div key={point} className="flex items-center gap-3 text-[14px] font-medium text-[#1f3a2f]">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.10)]" />
                        {point}
                      </div>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="relative order-1 lg:order-2">
                <div className="relative mx-auto aspect-[16/9] w-full max-w-[680px] overflow-hidden rounded-[28px] border border-emerald-950/[0.08] bg-[#fbfaf5] shadow-[0_24px_80px_-52px_rgba(16,185,129,0.36),0_16px_58px_-48px_rgba(15,23,42,0.28)] lg:max-w-[720px]">
                  {outputTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={`absolute inset-0 transition-opacity duration-200 ${
                        activeTab === tab.id ? "opacity-100" : "pointer-events-none opacity-0"
                      }`}
                    >
                      <Image
                        src={tab.image}
                        alt={tab.label}
                        fill
                        sizes="(max-width: 1024px) 100vw, 720px"
                        className="object-contain"
                        loading="lazy"
                      />
                    </div>
                  ))}
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_38%,rgba(16,185,129,0.10))]" />
                </div>
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="relative overflow-hidden px-[5%] py-16 md:py-24 lg:py-28">
        <GlowOrb color="rgba(16,185,129,0.10)" size={520} className="left-[-220px] top-[10%]" />
        <GlowOrb color="rgba(34,197,94,0.08)" size={460} className="bottom-[4%] right-[-160px]" />

        <div className="relative mx-auto max-w-[1240px]">
          <RevealSection delay={0.12}>
            <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-12">
              <div className="max-w-[520px]">
                <span className="mb-6 inline-flex items-center rounded-full border border-emerald-700/10 bg-white px-3 py-1 text-[12px] font-medium text-emerald-700">
                  Knowledge Layer
                </span>
                <h2
                  className="text-[clamp(2.5rem,5vw,4.6rem)] leading-[0.98] tracking-[-0.02em] text-[#10231c]"
                  style={{ fontFamily: "var(--font-instrument-serif), serif" }}
                >
                  少看一点。
                  <br />
                  <span className="italic text-emerald-700">记住更多。</span>
                </h2>
                <p className="mt-6 text-[17px] leading-[1.8] text-[#2d4a3a]">
                  每一次观看、阅读和追问，都会变成可以回看、检索、关联的个人知识。你不用记住内容在哪里，品猹会把线索留在知识库里。
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href="/login"
                    className="inline-flex h-12 items-center rounded-full bg-emerald-600 px-6 text-[15px] font-semibold text-white shadow-[0_18px_36px_-28px_rgba(5,150,105,0.9)] transition hover:bg-emerald-700"
                  >
                    开始品读
                  </a>
                  <a
                    href="#features"
                    className="inline-flex h-12 items-center rounded-full border border-[#e6dccd] bg-white px-6 text-[15px] font-semibold text-[#10231c] transition hover:border-emerald-700/30 hover:text-emerald-700"
                  >
                    查看能力
                  </a>
                </div>
              </div>

              <ProductImage
                src={cdnUrl("/landing/3d/mascot-overview-v1.png")}
                alt="品猹项目总览"
                className="mx-auto w-full max-w-[720px] bg-[#fbfaf5]/70 lg:max-w-none"
                imageClassName="object-contain"
                aspectRatio="1672 / 941"
              />
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="relative px-[5%] py-[12vh]">
        <div className="mx-auto max-w-[980px]">
          <RevealSection className="text-center">
            <h2
              className="mb-6 text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-[#10231c]"
              style={{ fontFamily: "var(--font-instrument-serif), serif" }}
            >
              视频、播客、文章。
              <br />
              <span className="text-[#0f1f17] italic">都可以被重新整理。</span>
            </h2>
            <p className="mx-auto max-w-[440px] text-[17px] leading-[1.7] text-[#2d4a3a]">
              从长视频到深度文章，从播客到每日线索，信息流变成你的学习路径。
            </p>
          </RevealSection>
        </div>
      </section>
    </div>
  );
}
