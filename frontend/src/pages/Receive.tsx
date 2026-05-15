import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { parseEventLogs, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { CopyButton, Spinner } from "../components/ui";
import { RequireWallet } from "../components/Wallet";
import { errorMessage } from "../hooks/usePayment";
import { routerAbi } from "../lib/abi";
import { chain, MAX_MEMO_LENGTH, ROUTER_ADDRESS } from "../lib/config";
import { parseAmount } from "../lib/format";

export function Receive() {
  return (
    <div className="narrow">
      <h1>Receive USDC</h1>
      <RequireWallet title="Connect a wallet to receive">
        <ReceiveInner />
      </RequireWallet>
    </div>
  );
}

function ReceiveInner() {
  const { address } = useAccount();
  const config = useConfig();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [onChain, setOnChain] = useState(!!ROUTER_ADDRESS);
  const [link, setLink] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const units = parseAmount(amount);

  async function createLink() {
    setError(undefined);
    if (!units) return setError("Enter an amount greater than 0");
    if (memo.length > MAX_MEMO_LENGTH) return setError(`Keep the note under ${MAX_MEMO_LENGTH} characters`);

    const origin = window.location.origin;
    if (!onChain || !ROUTER_ADDRESS) {
      const q = new URLSearchParams({ to: address!, amount: amount.trim(), ...(memo ? { memo } : {}) });
      return setLink(`${origin}/pay?${q}`);
    }

    setCreating(true);
    try {
      const hash = await writeContract(config, {
        address: ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: "createRequest",
        args: [units, 0n, memo],
        chainId: chain.id,
      });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: chain.id });
      const [created] = parseEventLogs({ abi: routerAbi, logs: receipt.logs, eventName: "RequestCreated" });
      setLink(`${origin}/pay?request=${created.args.requestId as Hex}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <section className="card receive-card">
        <div className="qr">
          <QRCodeSVG value={address!} size={168} marginSize={2} />
        </div>
        <div className="stack-sm">
          <div className="muted small">Your {chain.name} address</div>
          <div className="mono break">{address}</div>
          <div>
            <CopyButton value={address!} label="Copy address" />
          </div>
          <p className="fine-print">Only send USDC on {chain.name} to this address. Funds sent on other networks may be lost.</p>
        </div>
      </section>

      <section className="card">
        <h3>Request a payment</h3>
        <p className="muted small">Generate a checkout link anyone can open to pay you in a couple of taps.</p>
        <div className="form">
          <label className="field">
            <span>Amount</span>
            <div className="amount-input">
              <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span className="unit">USDC</span>
            </div>
          </label>
          <label className="field">
            <span>Note</span>
            <input placeholder="Invoice #1024, dinner, rent…" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
          {ROUTER_ADDRESS && (
            <label className="check">
              <input type="checkbox" checked={onChain} onChange={(e) => setOnChain(e.target.checked)} />
              <span>
                Create an on-chain invoice <em className="muted">(can only be paid once, costs a little gas)</em>
              </span>
            </label>
          )}
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-lg" disabled={creating} onClick={createLink}>
            {creating ? (
              <>
                <Spinner /> Creating invoice…
              </>
            ) : (
              "Create payment link"
            )}
          </button>
        </div>

        {link && (
          <div className="link-result">
            <QRCodeSVG value={link} size={120} marginSize={1} />
            <div className="stack-sm grow">
              <div className="mono break small">{link}</div>
              <div className="row gap-sm">
                <CopyButton value={link} label="Copy link" />
                <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noreferrer">
                  Preview ↗
                </a>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
