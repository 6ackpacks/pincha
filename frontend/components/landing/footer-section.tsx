"use client";

export function FooterSection() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="max-w-[980px] mx-auto px-[5%] py-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="品猹" width={20} height={20} className="text-white" style={{ filter: "invert(1)" }} />
            <span className="text-[13px] font-semibold text-white/45">品猹</span>
          </div>
          <span className="text-[12px] text-white/25">&copy; 2026 品猹</span>
        </div>
      </div>
    </footer>
  );
}
