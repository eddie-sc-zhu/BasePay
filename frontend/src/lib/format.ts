import { formatUnits, parseUnits } from "viem";
import { EXPLORER_URL } from "./config";

export const USDC_DECIMALS = 6;

export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtUnits(units: bigint): string {
  const n = Number(formatUnits(units, USDC_DECIMALS));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/** Parse a user-entered USDC amount. Returns null for anything invalid or non-positive. */
export function parseAmount(input: string): bigint | null {
  const v = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d{0,6}$/.test(v) || v === "" || v === ".") return null;
  const units = parseUnits(v, USDC_DECIMALS);
  return units > 0n ? units : null;
}

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export const txUrl = (hash: string) => (EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : undefined);
export const addressUrl = (addr: string) => (EXPLORER_URL ? `${EXPLORER_URL}/address/${addr}` : undefined);
