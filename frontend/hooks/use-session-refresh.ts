"use client";

import { useEffect, useRef } from "react";
import { refreshSession } from "@/lib/api/auth";

const REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

export function useSessionRefresh() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(async () => {
      try {
        await refreshSession();
      } catch {
        // Refresh failed — 401 interceptor will handle redirect
      }
    }, REFRESH_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
}
