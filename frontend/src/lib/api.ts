import { API_URL } from "./config";

export interface Transaction {
  tx_hash: string;
  log_index: number;
  block_number: number;
  timestamp: number;
  from_addr: string;
  to_addr: string;
  amount: number;
  amount_raw: string;
  direction: "in" | "out" | "self";
  kind: "transfer" | "payment" | "fee";
  memo: string | null;
  ref: string | null;
  payment_id: number | null;
  fee: number | null;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
  last_synced_block: number | null;
}

export interface DailyPoint {
  date: string;
  inflow: number;
  outflow: number;
}

export interface Analytics {
  address: string;
  summary: {
    total_in: number;
    total_out: number;
    net_flow: number;
    fees_paid: number;
    tx_count: number;
    sent_count: number;
    received_count: number;
    avg_sent: number;
    largest_sent: number;
    unique_counterparties: number;
  };
  daily: DailyPoint[];
  top_counterparties: { address: string; volume: number; count: number; sent: number; received: number }[];
}

export interface SyncResult {
  address: string;
  from_block: number;
  to_block: number;
  new_transfers: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  sync: (address: string) => request<SyncResult>(`/api/wallets/${address}/sync`, { method: "POST" }),
  analytics: (address: string, days = 30) => request<Analytics>(`/api/wallets/${address}/analytics?days=${days}`),
  transactions: (address: string, params: { limit?: number; offset?: number; direction?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return request<TransactionPage>(`/api/wallets/${address}/transactions?${q}`);
  },
};
