export default function Loading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "#f9fafb" }}
    >
      <div
        className="flex flex-col items-center gap-8 p-10 rounded-2xl"
        style={{
          background: "#ffffff",
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          minWidth: 340,
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-14 h-14 flex items-center justify-center animate-pulse"
            style={{ background: "#18E299", borderRadius: 16 }}
          >
            <span className="text-[#0d0d0d] font-bold text-2xl select-none">品</span>
          </div>
          <div className="space-y-2 flex flex-col items-center">
            <div className="h-5 w-16 bg-zinc-200 rounded animate-pulse" />
            <div className="h-3 w-36 bg-zinc-100 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-11 w-full bg-zinc-100 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
