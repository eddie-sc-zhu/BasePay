import { useState, type ReactNode } from "react";
import { addressUrl, short, txUrl } from "../lib/format";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

export function Address({ value, full }: { value: string; full?: boolean }) {
  const url = addressUrl(value);
  const text = full ? value : short(value);
  return url ? (
    <a className="mono link" href={url} target="_blank" rel="noreferrer" title={value}>
      {text}
    </a>
  ) : (
    <span className="mono" title={value}>
      {text}
    </span>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  const url = txUrl(hash);
  if (!url) return <span className="mono">{children ?? short(hash)}</span>;
  return (
    <a className="link" href={url} target="_blank" rel="noreferrer">
      {children ?? <span className="mono">{short(hash)}</span>}
    </a>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "active" : ""}>
          <span className="step-index">{i < current ? "✓" : i + 1}</span>
          <span className="step-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}
