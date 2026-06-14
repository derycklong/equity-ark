import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

// ---- Query keys (centralized for easy invalidation) ----
export const qk = {
  dashboard: ["dashboard"] as const,
  holdings: ["holdings"] as const,
  transactions: ["transactions"] as const,
  roundtrips: ["roundtrips"] as const,
  dividends: ["dividends"] as const,
  fundAliases: ["fundAliases"] as const,
};

// ---- Queries ----

export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
  });
}

export function useHoldings() {
  return useQuery({
    queryKey: qk.holdings,
    queryFn: () => api.holdings(),
    staleTime: 30_000,
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: qk.transactions,
    queryFn: () => api.transactions(),
    staleTime: 0,
  });
}

export function useRoundtrips() {
  return useQuery({
    queryKey: qk.roundtrips,
    queryFn: () => api.roundtrips(),
    staleTime: 60_000,
  });
}

export function useDividends() {
  return useQuery({
    queryKey: qk.dividends,
    queryFn: () => api.dividends(),
    staleTime: 60_000,
  });
}

export function useFundAliases() {
  return useQuery({
    queryKey: qk.fundAliases,
    queryFn: () => api.listFundAliases(),
    staleTime: Infinity,
  });
}

// ---- Mutation helpers that auto-invalidate ----

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.dashboard });
    qc.invalidateQueries({ queryKey: qk.holdings });
    qc.invalidateQueries({ queryKey: qk.transactions });
    qc.invalidateQueries({ queryKey: qk.roundtrips });
    qc.invalidateQueries({ queryKey: qk.dividends });
  };
}
