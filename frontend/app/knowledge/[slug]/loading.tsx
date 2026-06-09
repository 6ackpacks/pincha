export default function Loading() {
  return (
    <div className="flex min-h-screen bg-[#FAFAFA]">
      <div className="w-[240px] shrink-0 bg-white border-r border-zinc-200" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8 lg:p-12">
          <div className="h-7 w-32 bg-zinc-200 rounded-xl animate-pulse mb-6" />
          <div className="h-4 w-64 bg-zinc-100 rounded-lg animate-pulse mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left panel skeleton */}
            <div className="lg:col-span-1 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-white rounded-xl border border-zinc-200 animate-pulse" />
              ))}
            </div>
            {/* Right panel skeleton */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-200 p-6 space-y-4">
              <div className="h-6 w-48 bg-zinc-200 rounded animate-pulse" />
              <div className="h-4 w-full bg-zinc-100 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-zinc-100 rounded animate-pulse" />
              <div className="h-4 w-5/6 bg-zinc-100 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
