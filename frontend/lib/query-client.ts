import { QueryClient } from "@tanstack/react-query";

let _queryClient: QueryClient | undefined;

export function getQueryClient() {
  if (!_queryClient) {
    _queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000,
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
          refetchOnReconnect: "always",
          retry: 1,
        },
      },
    });
  }
  return _queryClient;
}

export function makeQueryClient() {
  return getQueryClient();
}
