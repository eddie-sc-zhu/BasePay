import { createConfig, http, type CreateConnectorFn, type Transport } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { chain, RPC_URL, WALLETCONNECT_PROJECT_ID } from "./lib/config";

const connectors: CreateConnectorFn[] = [injected(), coinbaseWallet({ appName: "BasePay" })];
if (WALLETCONNECT_PROJECT_ID) connectors.push(walletConnect({ projectId: WALLETCONNECT_PROJECT_ID }));

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http(RPC_URL) } as Record<typeof chain.id, Transport>,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
