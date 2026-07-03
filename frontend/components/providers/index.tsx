"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { ThemeProvider } from "next-themes";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { makeQueryClient } from "@/lib/query-client";
import { useSessionRefresh } from "@/hooks/use-session-refresh";

function SessionRefreshGuard({ children }: { children: React.ReactNode }) {
  useSessionRefresh();
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [queryClient] = useState(() => makeQueryClient());
  const isLanding = pathname === "/landing";

  if (isLanding) {
    return <>{children}</>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SessionRefreshGuard>{children}</SessionRefreshGuard>
        </ThemeProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );
}
