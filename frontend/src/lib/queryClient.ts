import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30s — data is fresh for 30s
      gcTime: 5 * 60_000,      // 5min — keep in cache after unmount
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
