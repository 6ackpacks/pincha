import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface LoadingPlaceholderProps {
  message?: string;
  className?: string;
}

export function LoadingPlaceholder({ message = "加载中...", className }: LoadingPlaceholderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}>
      <CircleNotch size={32} weight="bold" className="text-emerald-500 animate-spin" />
      <p className="text-sm text-zinc-400 font-medium">{message}</p>
    </div>
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
