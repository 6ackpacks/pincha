"use client";

import { useRef, useEffect } from "react";
import { useInView } from "framer-motion";
import { Navbar } from "@/components/landing/navbar";
import { LandingHeroSection } from "@/components/landing/shared";
import { FeaturesSection } from "@/components/landing/features-section";
import { CtaSection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";

export default function LandingPage() {
  const heroRef = useRef<HTMLElement>(null);
  const heroInView = useInView(heroRef, { amount: 0.1 });

  useEffect(() => {
    document.documentElement.classList.add("landing-scroll");
    return () => { document.documentElement.classList.remove("landing-scroll"); };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#141418] text-white overflow-x-hidden dark-landing noise-overlay">
      <Navbar heroInView={heroInView} />
      <LandingHeroSection heroRef={heroRef} />
      <FeaturesSection />
      <CtaSection />
      <FooterSection />
    </div>
  );
}
