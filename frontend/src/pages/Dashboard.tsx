import { Link } from "react-router-dom";
import { formatEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import { FlowChart } from "../components/FlowChart";
import { TxList } from "../components/TxList";
import { Address, Spinner, Stat } from "../components/ui";
import { RequireWallet } from "../components/Wallet";
import { useUsdcBalance } from "../hooks/useChainData";
import { useAnalytics, useIndexerSync, useTransactions } from "../hooks/useWalletData";
import { API_URL, chain } from "../lib/config";
import { fmtUnits, fmtUsd } from "../lib/format";

export function Dashboard() {
  return (
    <RequireWallet>
      <DashboardInner />
    </RequireWallet>
  );
}

function DashboardInner() {
  const { address } = useAccount();
  const usdc = useUsdcBalance();
  const eth = useBalance({ address, chainId: chain.id });
  const sync = useIndexerSync();
  const analytics = useAnalytics(30);
  const recent = useTransactions({ limit: 6, offset: 0, direction: "all" });
  const s = analytics.data?.summary;
  const lowGas = eth.data !== undefined && eth.data.value < 10n ** 13n;

  return (
    <div className="stack">
      <section className="hero card">
        <div>
          <div className="muted small">USDC balance</div>
          <div className="balance">
            {usdc.data !== undefined ? fmtUnits(usdc.data) : <Spinner />}
            <span className="unit">USDC</span>
          </div>
          <div className="muted small">
            <Address value={address!} /> · {eth.data ? `${Number(formatEther(eth.data.value)).toFixed(5)} ETH for gas` : "…"}
            {lowGas && <span className="pill pill-warn">Low gas</span>}
          </div>
        </div>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-lg" to="/send">
            ↑ Send
          </Link>
          <Link className="btn btn-ghost btn-lg" to="/receive">
            ↓ Receive
          </Link>
        </div>
      </section>

      {sync.offline && (
        <div className="banner banner-warn">
          Indexer unavailable at {API_URL}. Live balance still works, but history and analytics need the backend
          running. <span className="muted">({sync.error?.message})</span>
        </div>
      )}

      <section className="grid-stats">
        <Stat label="Received (30d)" value={s ? fmtUsd(s.total_in) : "—"} tone="up" />
        <Stat label="Sent (30d)" value={s ? fmtUsd(s.total_out) : "—"} />
        <Stat
          label="Net flow"
          value={s ? `${s.net_flow >= 0 ? "+" : "−"}${fmtUsd(Math.abs(s.net_flow))}` : "—"}
          tone={s && s.net_flow < 0 ? "down" : "up"}
        />
        <Stat label="Transactions" value={s?.tx_count ?? "—"} hint={s ? `${s.unique_counterparties} counterparties` : undefined} />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Cash flow · last 30 days</h3>
            <span className="muted small">
              {sync.syncing ? (
                <>
                  <Spinner /> Indexing…
                </>
              ) : (
                "Synced"
              )}
            </span>
          </div>
          {analytics.data ? <FlowChart data={analytics.data.daily} /> : <div className="chart-placeholder" />}
          {s && s.sent_count > 0 && (
            <div className="row gap muted small chart-foot">
              <span>Avg sent {fmtUsd(s.avg_sent)}</span>
              <span>Largest {fmtUsd(s.largest_sent)}</span>
              {s.fees_paid > 0 && <span>Fees {fmtUsd(s.fees_paid)}</span>}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Top counterparties</h3>
          </div>
          {analytics.data?.top_counterparties.length ? (
            <ul className="cp-list">
              {analytics.data.top_counterparties.map((c) => (
                <li key={c.address}>
                  <Address value={c.address} />
                  <span className="muted small">{c.count} tx</span>
                  <span className="cp-volume">{fmtUsd(c.volume)}</span>
                  <Link className="link small" to={`/send?to=${c.address}`}>
                    Pay
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">People you pay or get paid by will show up here.</p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Recent activity</h3>
          <Link className="link small" to="/history">
            View all →
          </Link>
        </div>
        <TxList items={recent.data?.items ?? []} empty={recent.isLoading ? "Loading…" : undefined} />
      </section>
    </div>
  );
}
