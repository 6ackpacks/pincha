"use client";

import { useRef } from "react";
import { useInView } from "framer-motion";
import { Navbar } from "@/components/landing/navbar";
import { LandingHeroSection } from "@/components/landing/shared";

export function HeroObserver() {
  const heroRef = useRef<HTMLElement>(null);
  const heroInView = useInView(heroRef, { amount: 0.1 });
  return (
    <>
      <Navbar heroInView={heroInView} />
      <LandingHeroSection heroRef={heroRef} />
    </>
  );
}
