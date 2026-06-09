import { Sidebar } from "@/components/layout/sidebar";

export default function VideoDetailLoading() {
  return (
    <div className="flex h-screen bg-[#FAFAFA] overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header skeleton */}
        <div className="sticky top-0 z-50 px-6 h-[60px] flex items-center gap-4 bg-white/80 backdrop-blur-md border-b border-zinc-200 animate-pulse">
          <div className="h-4 w-10 bg-zinc-200 rounded-lg" />
          <div className="w-px h-5 bg-zinc-200" />
          <div className="h-4 flex-1 max-w-xs bg-zinc-200 rounded-lg" />
          <div className="flex items-center gap-3 ml-auto">
            <div className="h-6 w-20 bg-zinc-100 rounded-full" />
            <div className="h-6 w-16 bg-zinc-100 rounded-full" />
            <div className="h-6 w-20 bg-zinc-100 rounded-full" />
          </div>
        </div>

        {/* Body skeleton */}
        <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Left column */}
          <div className="w-full lg:w-[55%] flex flex-col gap-4 p-6 animate-pulse">
            {/* Video player */}
            <div className="rounded-2xl aspect-video bg-zinc-200 flex-shrink-0" />
            {/* Action buttons */}
            <div className="flex gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 w-24 bg-zinc-100 rounded-xl" />
              ))}
            </div>
            {/* Metadata card */}
            <div className="rounded-2xl p-5 bg-white border border-zinc-100 flex-shrink-0">
              <div className="h-5 w-3/4 bg-zinc-100 rounded-lg mb-3" />
              <div className="h-4 w-1/3 bg-zinc-100 rounded-lg" />
            </div>
          </div>

          {/* Right column */}
          <div className="w-full lg:w-[45%] flex flex-col border-l border-zinc-200 bg-white animate-pulse">
            {/* Tab bar */}
            <div className="flex border-b border-zinc-200 px-2 h-[53px] items-center gap-1 bg-zinc-50/50">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-4 w-16 bg-zinc-100 rounded-lg mx-2" />
              ))}
            </div>
            {/* Content */}
            <div className="flex-1 p-4 space-y-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="h-4 w-10 bg-zinc-100 rounded shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-zinc-100 rounded w-full" />
                    <div className="h-3.5 bg-zinc-100 rounded w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
