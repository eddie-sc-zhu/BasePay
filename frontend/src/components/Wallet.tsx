import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "../lib/config";
import { short } from "../lib/format";
import { useIsWrongNetwork } from "../hooks/useChainData";
import { CopyButton } from "./ui";

export function WalletOptions({ onPick }: { onPick?: () => void }) {
  const { connectors, connect, isPending, error } = useConnect();
  const seen = new Set<string>();
  const unique = connectors.filter((c) => !seen.has(c.name) && seen.add(c.name));

  return (
    <div className="wallet-options">
      {unique.map((c) => (
        <button
          key={c.uid}
          className="wallet-option"
          disabled={isPending}
          onClick={() => {
            connect({ connector: c, chainId: chain.id });
            onPick?.();
          }}
        >
          {c.icon ? <img src={c.icon} alt="" /> : <span className="wallet-dot" />}
          {c.name === "Injected" ? "Browser wallet" : c.name}
        </button>
      ))}
      {error && <p className="error-text">{error.message.split("\n")[0]}</p>}
    </div>
  );
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="popover-anchor" ref={ref}>
      {isConnected ? (
        <button className="btn btn-ghost account-chip" onClick={() => setOpen((o) => !o)}>
          <span className="status-dot" />
          <span className="mono">{short(address)}</span>
        </button>
      ) : (
        <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>
          Connect wallet
        </button>
      )}
      {open && (
        <div className="popover">
          {isConnected && address ? (
            <>
              <div className="popover-label">Connected to {chain.name}</div>
              <div className="mono popover-address">{address}</div>
              <div className="row gap-sm">
                <CopyButton value={address} label="Copy address" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    disconnect();
                    setOpen(false);
                  }}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="popover-label">Choose a wallet</div>
              <WalletOptions onPick={() => setOpen(false)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function NetworkBanner() {
  const wrong = useIsWrongNetwork();
  const { switchChain, isPending } = useSwitchChain();
  if (!wrong) return null;
  return (
    <div className="banner banner-warn">
      <span>Your wallet is on the wrong network. BasePay runs on {chain.name}.</span>
      <button className="btn btn-sm btn-primary" disabled={isPending} onClick={() => switchChain({ chainId: chain.id })}>
        {isPending ? "Switching…" : `Switch to ${chain.name}`}
      </button>
    </div>
  );
}

export function RequireWallet({ children, title }: { children: ReactNode; title?: string }) {
  const { isConnected } = useAccount();
  if (isConnected) return <>{children}</>;
  return (
    <div className="card connect-card">
      <div className="connect-glyph">$</div>
      <h2>{title ?? "Connect your wallet"}</h2>
      <p className="muted">Send and receive USDC on {chain.name} in seconds. No account needed.</p>
      <WalletOptions />
    </div>
  );
}
