import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,        // 1 min default — balance freshness vs. request count
        gcTime: 10 * 60 * 1000,     // 10 min — keep cache in memory longer
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always", // refresh after network reconnect
        retry: 1,
      },
    },
  });
}
