import { useState } from "react";
import { TxList } from "../components/TxList";
import { Spinner } from "../components/ui";
import { RequireWallet } from "../components/Wallet";
import { useIndexerSync, useTransactions } from "../hooks/useWalletData";
import { api, type Transaction } from "../lib/api";

const PAGE = 20;
const FILTERS = [
  ["all", "All"],
  ["in", "Received"],
  ["out", "Sent"],
] as const;

export function History() {
  return (
    <div>
      <h1>History</h1>
      <RequireWallet>
        <HistoryInner />
      </RequireWallet>
    </div>
  );
}

function toCsv(rows: Transaction[]) {
  const header = ["timestamp", "direction", "kind", "amount_usdc", "from", "to", "memo", "tx_hash"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((t) =>
    [new Date(t.timestamp * 1000).toISOString(), t.direction, t.kind, t.amount, t.from_addr, t.to_addr, t.memo, t.tx_hash]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function HistoryInner() {
  const [direction, setDirection] = useState<string>("all");
  const [page, setPage] = useState(0);
  const sync = useIndexerSync();
  const txs = useTransactions({ limit: PAGE, offset: page * PAGE, direction });
  const total = txs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  async function exportCsv() {
    const all: Transaction[] = [];
    for (let offset = 0; offset < total; offset += 200) {
      all.push(...(await api.transactions(sync.address!, { limit: 200, offset, direction })).items);
    }
    const url = URL.createObjectURL(new Blob([toCsv(all)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `basepay-${direction}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card">
      <div className="card-head wrap">
        <div className="segmented">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              className={direction === key ? "active" : ""}
              onClick={() => {
                setDirection(key);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row gap-sm">
          <span className="muted small">
            {sync.syncing ? <Spinner /> : null} {total} transactions
            {txs.data?.last_synced_block ? ` · indexed to block ${txs.data.last_synced_block.toLocaleString()}` : ""}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => sync.refetch()} disabled={sync.syncing}>
            Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!total}>
            Export CSV
          </button>
        </div>
      </div>

      {sync.offline ? (
        <p className="empty">The indexer is offline. Start the backend to see transaction history.</p>
      ) : (
        <TxList items={txs.data?.items ?? []} empty={txs.isLoading || !sync.ready ? "Indexing your wallet…" : undefined} />
      )}

      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Newer
          </button>
          <span className="muted small">
            Page {page + 1} of {pages}
          </span>
          <button className="btn btn-ghost btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Older →
          </button>
        </div>
      )}
    </section>
  );
}
