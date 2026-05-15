import type { Transaction } from "../lib/api";
import { fmtUnits, timeAgo } from "../lib/format";
import { Address, TxLink } from "./ui";

const KIND_LABEL: Record<Transaction["kind"], string> = {
  payment: "BasePay",
  transfer: "Transfer",
  fee: "Network fee",
};

export function TxList({ items, empty }: { items: Transaction[]; empty?: string }) {
  if (items.length === 0) return <p className="empty">{empty ?? "No transactions yet."}</p>;
  return (
    <ul className="tx-list">
      {items.map((t) => {
        const incoming = t.direction === "in";
        const counterparty = incoming ? t.from_addr : t.to_addr;
        const isMintOrBurn = /^0x0{40}$/.test(counterparty);
        return (
          <li key={`${t.tx_hash}-${t.log_index}`} className="tx-row">
            <span className={`tx-icon ${incoming ? "in" : "out"}`}>{incoming ? "↓" : "↑"}</span>
            <div className="tx-main">
              <div className="tx-title">
                {t.memo ? <strong>{t.memo}</strong> : <strong>{incoming ? "Received" : "Sent"}</strong>}
                <span className={`pill pill-${t.kind}`}>{KIND_LABEL[t.kind]}</span>
              </div>
              <div className="tx-sub muted">
                {isMintOrBurn ? (incoming ? "Minted" : "Burned") : <>{incoming ? "from" : "to"} <Address value={counterparty} /></>}
                {" · "}
                <TxLink hash={t.tx_hash}>{timeAgo(t.timestamp)}</TxLink>
              </div>
            </div>
            <div className={`tx-amount ${incoming ? "up" : ""}`}>
              {incoming ? "+" : "−"}
              {fmtUnits(BigInt(t.amount_raw))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
