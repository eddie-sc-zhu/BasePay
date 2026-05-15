/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_ROUTER_ADDRESS?: string;
  readonly VITE_USDC_ADDRESS?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
