import { useState, type FormEvent } from "react";
import { getAddress, isAddress, type Hex } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { usePayment } from "../hooks/usePayment";
import { useIsWrongNetwork, useRouterFee, useUsdcBalance } from "../hooks/useChainData";
import { useRefreshWallet } from "../hooks/useWalletData";
import { chain, MAX_MEMO_LENGTH, ROUTER_ADDRESS } from "../lib/config";
import { fmtUnits, parseAmount } from "../lib/format";
import { Address, Spinner, Steps, TxLink } from "./ui";

type Stage = "details" | "review" | "processing" | "done";
const STAGES: Stage[] = ["details", "review", "processing", "done"];

interface Props {
  initial?: { to?: string; amount?: string; memo?: string };
  /** Recipient / amount / memo come from a payment link or invoice and can't be edited. */
  locked?: boolean;
  requestId?: Hex;
}

const METHOD_HINT = {
  permit: "One signature to authorize USDC, then one transaction. No separate approval needed.",
  approve: "Your wallet doesn't support permit signatures, so USDC is approved in a separate transaction first.",
  allowance: "USDC is already authorized, so this is a single transaction.",
  transfer: "Direct USDC transfer.",
} as const;

export function CheckoutFlow({ initial, locked, requestId }: Props) {
  const { address } = useAccount();
  const [stage, setStage] = useState<Stage>(locked ? "review" : "details");
  const [to, setTo] = useState(initial?.to ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [touched, setTouched] = useState(false);

  const balance = useUsdcBalance();
  const feeBps = useRouterFee();
  const wrongNetwork = useIsWrongNetwork();
  const { switchChain, isPending: switching } = useSwitchChain();
  const payment = usePayment();
  const refresh = useRefreshWallet();

  const units = parseAmount(amount);
  const fee = units ? (units * feeBps) / 10_000n : 0n;
  const errors = {
    to: !isAddress(to)
      ? "Enter a valid 0x address"
      : address && to.toLowerCase() === address.toLowerCase()
        ? "You can't pay yourself"
        : null,
    amount: !units
      ? "Enter an amount greater than 0 (max 6 decimals)"
      : balance.data !== undefined && units > balance.data
        ? `Insufficient balance. You have ${fmtUnits(balance.data)} USDC`
        : null,
    memo: memo.length > MAX_MEMO_LENGTH ? `Keep it under ${MAX_MEMO_LENGTH} characters` : null,
  };
  const valid = !errors.to && !errors.amount && !errors.memo;

  function onContinue(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (valid) setStage("review");
  }

  async function onConfirm() {
    if (!valid || !units) return;
    setStage("processing");
    const hash = await payment.pay({ to: getAddress(to), amount: units, memo: memo.trim(), requestId });
    if (hash) {
      setStage("done");
      refresh();
    }
  }

  function startOver() {
    payment.reset();
    setTo("");
    setAmount("");
    setMemo("");
    setTouched(false);
    setStage("details");
  }

  const stageIndex = STAGES.indexOf(stage);
  const labels = locked ? ["Review", "Pay", "Done"] : ["Details", "Review", "Pay", "Done"];

  return (
    <div className="card checkout">
      <Steps steps={labels} current={locked ? stageIndex - 1 : stageIndex} />

      {stage === "details" && (
        <form onSubmit={onContinue} className="form" noValidate>
          <label className="field">
            <span>Recipient</span>
            <input
              className="mono"
              placeholder="0x…"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              autoComplete="off"
              spellCheck={false}
            />
            {touched && errors.to && <small className="error-text">{errors.to}</small>}
          </label>

          <label className="field">
            <span className="row between">
              Amount
              {balance.data !== undefined && (
                <button type="button" className="link-btn" onClick={() => setAmount(fmtUnits(balance.data!).replace(/,/g, ""))}>
                  Balance: {fmtUnits(balance.data)} · Max
                </button>
              )}
            </span>
            <div className="amount-input">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="unit">USDC</span>
            </div>
            {touched && errors.amount && <small className="error-text">{errors.amount}</small>}
          </label>

          <label className="field">
            <span>
              Note <em className="muted">(optional{ROUTER_ADDRESS ? ", stored on-chain" : ""})</em>
            </span>
            <input placeholder="What's it for?" value={memo} maxLength={MAX_MEMO_LENGTH + 10} onChange={(e) => setMemo(e.target.value)} />
            {touched && errors.memo && <small className="error-text">{errors.memo}</small>}
          </label>

          <button className="btn btn-primary btn-lg" type="submit">
            Continue
          </button>
        </form>
      )}

      {stage === "review" && (
        <div className="review">
          <div className="review-amount">
            <span className="big">{units ? fmtUnits(units) : "—"}</span>
            <span className="unit">USDC</span>
          </div>
          <dl className="summary">
            <div>
              <dt>To</dt>
              <dd>{isAddress(to) ? <Address value={to} /> : "—"}</dd>
            </div>
            {memo && (
              <div>
                <dt>Note</dt>
                <dd>{memo}</dd>
              </div>
            )}
            <div>
              <dt>Network</dt>
              <dd>{chain.name}</dd>
            </div>
            {fee > 0n && (
              <div>
                <dt>Service fee ({Number(feeBps) / 100}%)</dt>
                <dd>{fmtUnits(fee)} USDC</dd>
              </div>
            )}
            <div className="total">
              <dt>Recipient gets</dt>
              <dd>{units ? fmtUnits(units - fee) : "—"} USDC</dd>
            </div>
          </dl>

          {!valid && <p className="error-text">{errors.to ?? errors.amount ?? errors.memo}</p>}

          <div className="row gap">
            {!locked && (
              <button className="btn btn-ghost btn-lg" onClick={() => setStage("details")}>
                Back
              </button>
            )}
            {wrongNetwork ? (
              <button className="btn btn-primary btn-lg grow" disabled={switching} onClick={() => switchChain({ chainId: chain.id })}>
                {switching ? "Switching…" : `Switch to ${chain.name}`}
              </button>
            ) : (
              <button className="btn btn-primary btn-lg grow" disabled={!valid} onClick={onConfirm}>
                Confirm & pay
              </button>
            )}
          </div>
          <p className="fine-print">Gas is paid in ETH on Base and usually costs less than a cent.</p>
        </div>
      )}

      {stage === "processing" && (
        <div className="processing">
          <ul className="phases">
            {payment.phases.map((p) => (
              <li key={p.key} className={`phase ${p.status}`}>
                <span className="phase-icon">
                  {p.status === "active" ? <Spinner /> : p.status === "done" ? "✓" : p.status === "error" ? "!" : ""}
                </span>
                {p.label}
              </li>
            ))}
          </ul>
          {payment.method && payment.status === "running" && <p className="muted small">{METHOD_HINT[payment.method]}</p>}
          {payment.hash && (
            <p className="small">
              Transaction: <TxLink hash={payment.hash} />
            </p>
          )}
          {payment.status === "error" && (
            <>
              <div className="banner banner-error">{payment.error}</div>
              <div className="row gap">
                <button className="btn btn-primary btn-lg grow" onClick={() => setStage("review")}>
                  Try again
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {stage === "done" && units !== null && (
        <div className="receipt">
          <div className="receipt-check">✓</div>
          <h2>Payment sent</h2>
          <p className="muted">
            {fmtUnits(units - fee)} USDC delivered to <Address value={to} />
          </p>
          {payment.hash && (
            <TxLink hash={payment.hash}>
              <span className="btn btn-ghost">View on explorer ↗</span>
            </TxLink>
          )}
          {!locked && (
            <button className="btn btn-primary btn-lg" onClick={startOver}>
              Send another
            </button>
          )}
        </div>
      )}
    </div>
  );
}
