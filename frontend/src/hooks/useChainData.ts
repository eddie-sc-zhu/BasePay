import { useAccount, useReadContract } from "wagmi";
import { routerAbi, usdcAbi } from "../lib/abi";
import { chain, ROUTER_ADDRESS, USDC_ADDRESS } from "../lib/config";

export function useUsdcBalance() {
  const { address } = useAccount();
  return useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: chain.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}

/** Router fee in basis points (0 when no router is configured). */
export function useRouterFee(): bigint {
  const { data } = useReadContract({
    address: ROUTER_ADDRESS,
    abi: routerAbi,
    functionName: "feeBps",
    chainId: chain.id,
    query: { enabled: !!ROUTER_ADDRESS, staleTime: 5 * 60_000 },
  });
  return BigInt(data ?? 0);
}

export function useIsWrongNetwork() {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId !== chain.id;
}
