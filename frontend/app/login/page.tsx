"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { sanitizeUserFacingError } from "@/lib/utils";

function LoginInner() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const loginError = sanitizeUserFacingError(
    error ? decodeURIComponent(error) : null,
    "登录失败，请稍后重试",
  );

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
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/brand/pincha-script.svg"
            alt="Pincha"
            width={180}
            height={72}
            priority
            unoptimized
            className="h-auto w-[150px] object-contain sm:w-[180px]"
          />
          <div className="space-y-1">
            <div className="text-[26px] font-semibold tracking-[0.16em] text-zinc-900 sm:text-[30px]">
              品猹
            </div>
            <div className="text-[11px] font-medium tracking-[0.42em] text-zinc-400 sm:text-xs">
              PINCHA
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="w-full text-center text-sm px-4 py-2.5 rounded-2xl"
            style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}
          >
            {loginError}
          </div>
        )}

        <div className="max-w-[460px] space-y-3 text-center">
          <p className="text-lg font-medium leading-8 text-zinc-700 sm:text-[22px] sm:leading-9">
            让信息有归处
          </p>
          <p className="text-sm leading-7 text-zinc-400 sm:text-[15px]">
            把每天遇到的视频、播客、文章与猹选线索，
            <br className="hidden sm:block" />
            整理进可检索、可追问、可沉淀的个人知识库。
          </p>
        </div>

        {/* Login button */}
        <a
          href={`${apiBase}/api/v1/auth/login`}
          className="flex w-full max-w-[520px] items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white px-6 py-4 font-semibold text-sm text-zinc-900 transition-all duration-150 hover:border-emerald-200 hover:bg-emerald-50 active:scale-[0.99] sm:text-base"
          style={{
            textDecoration: "none",
          }}
        >
          <Image
            src="/brand/guancha-icon.svg"
            alt=""
            aria-hidden="true"
            width={24}
            height={24}
            unoptimized
            priority
            className="h-6 w-6 shrink-0 object-contain"
          />
          使用观猹账号登录
        </a>

        {/* Dev login — only works when backend runs in development mode */}
        {process.env.NODE_ENV === "development" && (
          <a
            href={`${apiBase}/api/v1/auth/dev-login`}
            className="w-full flex items-center justify-center gap-2.5 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-3 font-medium text-xs text-zinc-500 transition-all duration-150 hover:bg-zinc-100"
            style={{
              textDecoration: "none",
            }}
          >
            本地开发登录（跳过 OAuth）
          </a>
        )}

        <p className="text-xs text-center text-zinc-300">
          登录后，继续整理你的线索与知识
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9fafb" }}>
          <div className="flex w-full max-w-[720px] flex-col items-center gap-8 rounded-[28px] border border-zinc-200 bg-white px-8 py-10 shadow-[0_18px_48px_-38px_rgba(15,23,42,0.35)]">
            <div className="h-12 w-40 rounded-full bg-zinc-100 animate-pulse" />
            <div className="space-y-2 text-center">
              <div className="mx-auto h-8 w-28 rounded-full bg-zinc-200 animate-pulse" />
              <div className="mx-auto h-4 w-20 rounded-full bg-zinc-100 animate-pulse" />
            </div>
            <div className="space-y-3 text-center">
              <div className="mx-auto h-6 w-36 rounded-full bg-zinc-100 animate-pulse" />
              <div className="mx-auto h-4 w-72 rounded-full bg-zinc-100 animate-pulse" />
              <div className="mx-auto h-4 w-64 rounded-full bg-zinc-100 animate-pulse" />
            </div>
            <div className="h-14 w-full max-w-[520px] rounded-2xl bg-zinc-100 animate-pulse" />
          </div>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
