import { cn } from "@/lib/utils";
import { cdnUrl } from "@/lib/cdn";

type MascotScene = "parsing" | "thinking" | "searching" | "compiling" | "empty" | "error" | "done";

const MASCOT_GIF: Record<MascotScene, string> = {
  parsing: cdnUrl("/mascot/cha_lens.gif"),
  thinking: cdnUrl("/mascot/icon_thinking.gif"),
  searching: cdnUrl("/mascot/loading.gif"),
  compiling: cdnUrl("/mascot/cha_star.gif"),
  empty: cdnUrl("/mascot/empty_state.gif"),
  error: cdnUrl("/mascot/error.gif"),
  done: cdnUrl("/mascot/cha_cheer.gif"),
};

const MASCOT_SIZE: Record<string, string> = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
};

interface MascotLoadingProps {
  scene: MascotScene;
  message?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function MascotLoading({ scene, message, size = "md", className }: MascotLoadingProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-8", className)}>
      <img
        src={MASCOT_GIF[scene]}
        alt=""
        className={cn(MASCOT_SIZE[size], "object-contain")}
      />
      {message && (
        <p className="text-sm text-zinc-400 font-medium">{message}</p>
      )}
    </div>
  );
}

interface LoadingPlaceholderProps {
  message?: string;
  className?: string;
}

export function LoadingPlaceholder({ message = "加载中...", className }: LoadingPlaceholderProps) {
  return (
    <MascotLoading scene="thinking" message={message} className={className} />
  );
}

interface AnimatedDotsProps {
  className?: string;
}

export function AnimatedDots({ className }: AnimatedDotsProps) {
  return (
    <span className={cn("inline-flex gap-0.5", className)}>
      <span className="animate-[bounce_1.4s_ease-in-out_0s_infinite]">.</span>
      <span className="animate-[bounce_1.4s_ease-in-out_0.2s_infinite]">.</span>
      <span className="animate-[bounce_1.4s_ease-in-out_0.4s_infinite]">.</span>
    </span>
  );
}

interface StreamingIndicatorProps {
  message?: string;
  className?: string;
}

export function StreamingIndicator({ message = "生成中", className }: StreamingIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 mt-2", className)}>
      <AnimatedDots />
      <span className="font-medium">{message}</span>
    </div>
  );
}
