import { useSearchParams } from "react-router-dom";
import { formatUnits, isAddress, isHex, type Hex } from "viem";
import { useReadContract } from "wagmi";
import { CheckoutFlow } from "../components/CheckoutFlow";
import { Address, Spinner } from "../components/ui";
import { RequireWallet } from "../components/Wallet";
import { REQUEST_STATUS, routerAbi } from "../lib/abi";
import { chain, ROUTER_ADDRESS } from "../lib/config";
import { fmtUnits, parseAmount } from "../lib/format";

/** Public checkout page reached via a payment link: /pay?to=&amount=&memo= or /pay?request=0x… */
export function Pay() {
  const [params] = useSearchParams();
  const requestId = params.get("request");
  return (
    <div className="narrow">
      {requestId ? <InvoiceCheckout requestId={requestId} /> : <LinkCheckout params={params} />}
    </div>
  );
}

function CheckoutHeader({ payee, amount, memo }: { payee: string; amount: bigint; memo?: string }) {
  return (
    <div className="pay-header">
      <div className="muted small">Payment request on {chain.name}</div>
      <div className="balance">
        {fmtUnits(amount)}
        <span className="unit">USDC</span>
      </div>
      {memo && <div className="pay-memo">“{memo}”</div>}
      <div className="muted small">
        to <Address value={payee} />
      </div>
    </div>
  );
}

function LinkCheckout({ params }: { params: URLSearchParams }) {
  const to = params.get("to") ?? "";
  const amount = params.get("amount") ?? "";
  const memo = params.get("memo") ?? "";
  const units = parseAmount(amount);

  if (!isAddress(to) || !units) {
    return <div className="card empty">This payment link is invalid or incomplete.</div>;
  }
  return (
    <div className="stack">
      <CheckoutHeader payee={to} amount={units} memo={memo} />
      <RequireWallet title="Connect a wallet to pay">
        <CheckoutFlow locked initial={{ to, amount, memo }} />
      </RequireWallet>
    </div>
  );
}

function InvoiceCheckout({ requestId }: { requestId: string }) {
  const validId = isHex(requestId) && requestId.length === 66;
  const { data, isLoading, error } = useReadContract({
    address: ROUTER_ADDRESS,
    abi: routerAbi,
    functionName: "requests",
    args: [requestId as Hex],
    chainId: chain.id,
    query: { enabled: !!ROUTER_ADDRESS && validId, refetchInterval: 10_000 },
  });

  if (!ROUTER_ADDRESS) return <div className="card empty">Invoices aren't enabled on this deployment.</div>;
  if (!validId) return <div className="card empty">Invalid invoice link.</div>;
  if (isLoading) return <div className="card empty"><Spinner /> Loading invoice…</div>;
  if (error || !data) return <div className="card empty">Couldn't load this invoice.</div>;

  const [payee, amount, expiresAt, status, payer, memo] = data;
  const statusName = REQUEST_STATUS[status] ?? "None";
  const expired = expiresAt > 0n && Number(expiresAt) * 1000 < Date.now();

  if (statusName === "None") return <div className="card empty">Invoice not found.</div>;

  return (
    <div className="stack">
      <CheckoutHeader payee={payee} amount={amount} memo={memo} />
      {statusName === "Paid" ? (
        <div className="card receipt">
          <div className="receipt-check">✓</div>
          <h2>Invoice paid</h2>
          <p className="muted">
            Paid by <Address value={payer} />
          </p>
        </div>
      ) : statusName === "Cancelled" ? (
        <div className="card empty">This invoice was cancelled by the recipient.</div>
      ) : expired ? (
        <div className="card empty">This invoice has expired.</div>
      ) : (
        <RequireWallet title="Connect a wallet to pay">
          <CheckoutFlow locked requestId={requestId as Hex} initial={{ to: payee, amount: formatUnits(amount, 6), memo }} />
        </RequireWallet>
      )}
    </div>
  );
}
