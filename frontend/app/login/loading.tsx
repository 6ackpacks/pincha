export default function Loading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#f9fafb" }}
    >
      <div
        className="flex w-full max-w-[720px] flex-col items-center gap-8 rounded-[28px] border border-zinc-200 bg-white px-6 py-10 shadow-[0_18px_48px_-38px_rgba(15,23,42,0.35)] sm:px-10 sm:py-12"
        style={{
          minWidth: 320,
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-40 rounded-full bg-zinc-100 animate-pulse" />
          <div className="space-y-2 flex flex-col items-center">
            <div className="h-8 w-28 bg-zinc-200 rounded-full animate-pulse" />
            <div className="h-4 w-20 bg-zinc-100 rounded-full animate-pulse" />
          </div>
        </div>
        <div className="space-y-3 text-center">
          <div className="mx-auto h-6 w-36 rounded-full bg-zinc-100 animate-pulse" />
          <div className="mx-auto h-4 w-72 rounded-full bg-zinc-100 animate-pulse" />
          <div className="mx-auto h-4 w-64 rounded-full bg-zinc-100 animate-pulse" />
        </div>
        <div className="h-14 w-full max-w-[520px] rounded-2xl bg-zinc-100 animate-pulse" />
      </div>
    </div>
  );
}
