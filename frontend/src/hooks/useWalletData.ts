import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api } from "../lib/api";

/**
 * Asks the backend indexer to catch up on the connected wallet, then exposes
 * `syncedAt` so dependent queries refetch once fresh data has been indexed.
 */
export function useIndexerSync() {
  const { address } = useAccount();
  const sync = useQuery({
    queryKey: ["sync", address],
    queryFn: () => api.sync(address!),
    enabled: !!address,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
  });
  return {
    address,
    syncing: sync.isFetching,
    syncedAt: sync.dataUpdatedAt,
    ready: sync.isFetched,
    offline: sync.isError,
    error: sync.error as Error | null,
    refetch: sync.refetch,
  };
}

export function useAnalytics(days = 30) {
  const { address, syncedAt, ready } = useIndexerSync();
  return useQuery({
    queryKey: ["analytics", address, days, syncedAt],
    queryFn: () => api.analytics(address!, days),
    enabled: !!address && ready,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

export function useTransactions(params: { limit: number; offset: number; direction: string }) {
  const { address, syncedAt, ready } = useIndexerSync();
  return useQuery({
    queryKey: ["transactions", address, params, syncedAt],
    queryFn: () => api.transactions(address!, params),
    enabled: !!address && ready,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

/** Call after a payment lands so balances & history refresh immediately. */
export function useRefreshWallet() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["sync"] });
    qc.invalidateQueries({ queryKey: ["readContract"] });
  };
}
