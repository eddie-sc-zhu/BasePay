import type { Address } from "viem";
import { base, baseSepolia, hardhat } from "wagmi/chains";

const CHAINS = { base, "base-sepolia": baseSepolia, localhost: hardhat } as const;

export const chain = CHAINS[(import.meta.env.VITE_CHAIN ?? "base-sepolia") as keyof typeof CHAINS] ?? baseSepolia;

// Circle's native USDC
const USDC_BY_CHAIN: Record<number, Address> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS || USDC_BY_CHAIN[chain.id]) as Address;
export const ROUTER_ADDRESS = (import.meta.env.VITE_ROUTER_ADDRESS || undefined) as Address | undefined;
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const RPC_URL = import.meta.env.VITE_RPC_URL || undefined;
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined;

export const EXPLORER_URL: string | undefined = chain.blockExplorers?.default.url;
export const MAX_MEMO_LENGTH = 140;
