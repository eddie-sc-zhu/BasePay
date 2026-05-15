import { useState } from "react";
import { BaseError, UserRejectedRequestError, parseSignature, toHex, type Address, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { readContract, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { routerAbi, usdcAbi } from "../lib/abi";
import { chain, ROUTER_ADDRESS, USDC_ADDRESS } from "../lib/config";

export interface PaymentInput {
  to: Address;
  amount: bigint;
  memo: string;
  requestId?: Hex;
}

export type PhaseStatus = "pending" | "active" | "done" | "error";
export interface Phase {
  key: "authorize" | "submit" | "confirm";
  label: string;
  status: PhaseStatus;
}

export type PaymentMethod = "permit" | "approve" | "allowance" | "transfer";

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((err) => err instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

function isUserRejection(e: unknown) {
  return e instanceof BaseError && !!e.walk((err) => err instanceof UserRejectedRequestError);
}

const randomRef = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

/**
 * Drives a USDC payment end to end, choosing the lowest-friction path:
 *   1. existing allowance  → 1 tx
 *   2. EIP-2612 permit     → 1 signature + 1 tx
 *   3. approve fallback    → 2 txs (smart wallets / wallets without typed-data support)
 *   4. no router deployed  → plain USDC transfer
 */
export function usePayment() {
  const config = useConfig();
  const { address } = useAccount();
  const [phases, setPhases] = useState<Phase[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [method, setMethod] = useState<PaymentMethod>();
  const [hash, setHash] = useState<Hex>();
  const [error, setError] = useState<string>();

  const begin = (m: PaymentMethod, steps: [Phase["key"], string][]) => {
    setMethod(m);
    setPhases(steps.map(([key, label], i) => ({ key, label, status: i === 0 ? "active" : "pending" })));
  };
  const advance = (key: Phase["key"]) =>
    setPhases((ps) => {
      const i = ps.findIndex((p) => p.key === key);
      return ps.map((p, j) => (j < i ? { ...p, status: "done" } : j === i ? { ...p, status: "active" } : p));
    });

  async function submitAndConfirm(send: () => Promise<Hex>): Promise<Hex> {
    advance("submit");
    const h = await send();
    setHash(h);
    advance("confirm");
    const receipt = await waitForTransactionReceipt(config, { hash: h, chainId: chain.id });
    if (receipt.status !== "success") throw new Error("Transaction reverted on-chain.");
    return h;
  }

  async function signPermit(owner: Address, spender: Address, value: bigint) {
    const [name, nonce] = await Promise.all([
      readContract(config, { address: USDC_ADDRESS, abi: usdcAbi, functionName: "name", chainId: chain.id }),
      readContract(config, { address: USDC_ADDRESS, abi: usdcAbi, functionName: "nonces", args: [owner], chainId: chain.id }),
    ]);
    // FiatToken exposes version() ("2"); OpenZeppelin ERC20Permit defaults to "1"
    const version = await readContract(config, {
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "version",
      chainId: chain.id,
    }).catch(() => "1");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);

    const signature = await signTypedData(config, {
      domain: { name, version, chainId: chain.id, verifyingContract: USDC_ADDRESS },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner, spender, value, nonce, deadline },
    });
    // Smart-contract wallets return wrapped (ERC-1271/6492) signatures the v/r/s path can't use
    if (signature.length !== 132) return null;
    const { r, s, v, yParity } = parseSignature(signature);
    return { deadline, r, s, v: Number(v ?? BigInt(yParity + 27)) };
  }

  async function viaTransfer(input: PaymentInput): Promise<Hex> {
    if (input.requestId) throw new Error("Payment requests need the BasePay router to be configured.");
    begin("transfer", [
      ["submit", "Send USDC"],
      ["confirm", "Confirm on Base"],
    ]);
    return submitAndConfirm(() =>
      writeContract(config, {
        address: USDC_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [input.to, input.amount],
        chainId: chain.id,
      }),
    );
  }

  async function viaRouter(owner: Address, router: Address, input: PaymentInput): Promise<Hex> {
    const ref = randomRef();
    const payWithAllowance = () =>
      input.requestId
        ? writeContract(config, { address: router, abi: routerAbi, functionName: "payRequest", args: [input.requestId], chainId: chain.id })
        : writeContract(config, {
            address: router,
            abi: routerAbi,
            functionName: "pay",
            args: [input.to, input.amount, ref, input.memo],
            chainId: chain.id,
          });

    const allowance = await readContract(config, {
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "allowance",
      args: [owner, router],
      chainId: chain.id,
    });
    if (allowance >= input.amount) {
      begin("allowance", [
        ["submit", "Submit payment"],
        ["confirm", "Confirm on Base"],
      ]);
      return submitAndConfirm(payWithAllowance);
    }

    begin("permit", [
      ["authorize", "Authorize USDC (signature)"],
      ["submit", "Submit payment"],
      ["confirm", "Confirm on Base"],
    ]);
    let permit: Awaited<ReturnType<typeof signPermit>> = null;
    try {
      permit = await signPermit(owner, router, input.amount);
    } catch (e) {
      if (isUserRejection(e)) throw e;
    }

    if (permit) {
      const { deadline, v, r, s } = permit;
      return submitAndConfirm(() =>
        input.requestId
          ? writeContract(config, {
              address: router,
              abi: routerAbi,
              functionName: "payRequestWithPermit",
              args: [input.requestId, deadline, v, r, s],
              chainId: chain.id,
            })
          : writeContract(config, {
              address: router,
              abi: routerAbi,
              functionName: "payWithPermit",
              args: [input.to, input.amount, ref, input.memo, deadline, v, r, s],
              chainId: chain.id,
            }),
      );
    }

    // Fallback: classic approve + pay
    setMethod("approve");
    setPhases((ps) => ps.map((p) => (p.key === "authorize" ? { ...p, label: "Approve USDC (transaction)" } : p)));
    const approveHash = await writeContract(config, {
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "approve",
      args: [router, input.amount],
      chainId: chain.id,
    });
    await waitForTransactionReceipt(config, { hash: approveHash, chainId: chain.id });
    return submitAndConfirm(payWithAllowance);
  }

  async function pay(input: PaymentInput): Promise<Hex | undefined> {
    if (!address) return;
    setStatus("running");
    setError(undefined);
    setHash(undefined);
    try {
      const h = ROUTER_ADDRESS ? await viaRouter(address, ROUTER_ADDRESS, input) : await viaTransfer(input);
      setPhases((ps) => ps.map((p) => ({ ...p, status: "done" })));
      setStatus("success");
      return h;
    } catch (e) {
      setPhases((ps) => ps.map((p) => (p.status === "active" ? { ...p, status: "error" } : p)));
      setStatus("error");
      setError(errorMessage(e));
    }
  }

  function reset() {
    setStatus("idle");
    setPhases([]);
    setMethod(undefined);
    setHash(undefined);
    setError(undefined);
  }

  return { pay, reset, phases, status, method, hash, error };
}
