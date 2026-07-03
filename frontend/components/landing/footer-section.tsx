export function FooterSection() {
  return (
    <footer className="border-t border-emerald-950/[0.08] bg-[#fbfaf5]">
      <div className="max-w-[980px] mx-auto px-[5%] py-12">
        <div className="flex items-center justify-between">
          <img
            src="/brand/pincha-wordmark.svg"
            alt="Pincha"
            className="h-12 w-[156px] object-contain object-left"
          />
          <span className="text-[12px] text-[#36564a]/75">&copy; 2026 品猹</span>
        </div>
      </div>
    </footer>
  );
}
