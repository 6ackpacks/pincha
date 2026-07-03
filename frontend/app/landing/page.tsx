import type { Metadata } from "next";
import { FeaturesSection } from "@/components/landing/features-section";
import { CtaSection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";
import { HeroObserver } from "@/components/landing/hero-observer";
import { LandingScrollClass } from "@/components/landing/landing-scroll-class";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "品猹 — 让信息有归处",
  description: "整理视频、播客、文章与每日线索，汇入可检索、可追问的个人知识库。Watch Less, Know More.",
  openGraph: {
    title: "品猹 — 让信息有归处",
    description: "整理视频、播客、文章与每日线索，汇入可检索、可追问的个人知识库。",
    type: "website",
    locale: "zh_CN",
  },
};

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-[#f7fbf7] text-[#13241d] overflow-x-hidden noise-overlay">
      <main id="main-content">
        <HeroObserver />
        <FeaturesSection />
        <CtaSection />
      </main>
      <FooterSection />
      <LandingScrollClass />
    </div>
  );
}
