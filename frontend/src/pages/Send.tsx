import { useSearchParams } from "react-router-dom";
import { CheckoutFlow } from "../components/CheckoutFlow";
import { RequireWallet } from "../components/Wallet";

export function Send() {
  const [params] = useSearchParams();
  return (
    <div className="narrow">
      <h1>Send USDC</h1>
      <RequireWallet title="Connect a wallet to send">
        <CheckoutFlow
          initial={{ to: params.get("to") ?? "", amount: params.get("amount") ?? "", memo: params.get("memo") ?? "" }}
        />
      </RequireWallet>
    </div>
  );
}
