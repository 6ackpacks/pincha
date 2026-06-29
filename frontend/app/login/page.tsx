"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Image from "next/image";

function LoginInner() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

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
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="品猹" width={56} height={56} className="rounded-full" />
          <div className="text-center">
            <div className="font-semibold text-lg" style={{ color: "#0d0d0d", letterSpacing: "-0.3px" }}>
              品猹
            </div>
            <div className="text-sm" style={{ color: "#9ca3af" }}>
              让信息有归处
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="w-full text-center text-sm px-4 py-2.5 rounded-xl"
            style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}
          >
            {decodeURIComponent(error)}
          </div>
        )}

        {/* Login button */}
        <a
          href={`${apiBase}/api/v1/auth/login`}
          className="w-full flex items-center justify-center gap-2.5 py-3 px-6 rounded-xl font-medium text-sm transition-all duration-150 hover:opacity-90"
          style={{
            background: "#18E299",
            color: "#0d0d0d",
            textDecoration: "none",
          }}
        >
          使用观猹账号登录
        </a>

        {/* Dev login — only works when backend runs in development mode */}
        {process.env.NODE_ENV === "development" && (
          <a
            href={`${apiBase}/api/v1/auth/dev-login`}
            className="w-full flex items-center justify-center gap-2.5 py-2.5 px-6 rounded-xl font-medium text-xs transition-all duration-150 hover:opacity-80"
            style={{
              background: "#f3f4f6",
              color: "#6b7280",
              textDecoration: "none",
              border: "1px dashed #d1d5db",
            }}
          >
            本地开发登录（跳过 OAuth）
          </a>
        )}

        <p className="text-xs text-center" style={{ color: "#d1d5db" }}>
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
          <div className="animate-spin w-6 h-6 border-2 border-zinc-600 border-t-transparent rounded-full" />
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
