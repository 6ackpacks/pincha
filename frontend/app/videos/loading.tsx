import { cdnUrl } from "@/lib/cdn";

export default function Loading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <img
          src={cdnUrl("/mascot/cha_lens.gif")}
          alt=""
          className="w-24 h-24 object-contain"
        />
        <p className="text-sm text-zinc-400 font-medium">加载中...</p>
      </div>
    </div>
  );
}
