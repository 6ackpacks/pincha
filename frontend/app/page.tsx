"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { HeroSection } from "@/components/home/hero-section";
import { RecommendedVideos } from "@/components/home/recommended-videos";
import { SubscribedChannels } from "@/components/home/subscribed-channels";

export default function Home() {
  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 min-h-0 overflow-y-auto">
        <HeroSection />
        <RecommendedVideos />
        <SubscribedChannels />
      </main>
    </div>
  );
}
