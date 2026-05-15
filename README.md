# BasePay

USDC payments and wallet analytics on [Base](https://base.org). Connect a wallet, send and receive USDC with a consumer-style checkout, share payment links and on-chain invoices, and track your activity on an analytics dashboard.

```
contracts/   Solidity: BasePayRouter (Hardhat, OpenZeppelin 5)
backend/     FastAPI indexer: Base JSON-RPC → normalized SQLite → REST API
frontend/    React + TypeScript + wagmi/viem (Vite)
```

## Architecture

```
 ┌────────────┐  wagmi / viem   ┌──────────────────┐   transferFrom   ┌──────┐
 │  Frontend  │ ───────────────▶│  BasePayRouter   │ ────────────────▶│ USDC │
 │  (React)   │                 │  pay / permit /  │                  └──┬───┘
 └─────┬──────┘                 │  invoices / fee  │                     │ Transfer
       │ REST                   └────────┬─────────┘                     │ logs
       ▼                                 │ PaymentSent logs              │
 ┌────────────┐   eth_getLogs (chunked, adaptive)                        │
 │  FastAPI   │ ◀────────────────────────┴───────────────────────────────┘
 │  indexer   │ ──▶ SQLite: transfers enriched with memo / ref / payment id / fee leg
 └────────────┘
```

### Smart contract (`contracts/contracts/BasePayRouter.sol`)
- `pay(to, amount, ref, memo)` routes USDC with an on-chain memo and a 32-byte reference, and emits `PaymentSent`.
- `payWithPermit(...)` lets a payer check out with **one signature and one transaction** (EIP-2612), with no separate approve step. The permit is wrapped in `try/catch`, so a front-run permit can't grief the payment.
- `createRequest` / `payRequest` / `payRequestWithPermit` / `cancelRequest` implement on-chain invoices. They support optional expiry and can be paid exactly once.
- Optional protocol fee in basis points, capped at 1%, with an owner-only `setFee`.
- Uses `SafeERC20` and `ReentrancyGuard`, and reports failures through custom errors.

### Backend (`backend/app`)
- **Indexer.** For each tracked wallet it pulls USDC `Transfer` logs (in and out) and `PaymentSent` logs in block chunks. On RPC range errors the chunk size halves adaptively. It respects a confirmation depth and syncs incrementally from `last_synced_block`, and re-syncing is idempotent.
- **Normalization.** USDC transfers are the source of truth. Transfers routed through the router are joined to their `PaymentSent` event and tagged `payment` (with memo, ref and payment id) or `fee`.
- **API**
  | Method | Path | |
  |---|---|---|
  | GET | `/api/health` | chain & contract config |
  | GET | `/api/wallets/{addr}/balance` | live USDC + ETH balance |
  | POST | `/api/wallets/{addr}/sync` | index new blocks for a wallet |
  | GET | `/api/wallets/{addr}/transactions?limit&offset&direction` | paginated history |
  | GET | `/api/wallets/{addr}/analytics?days=30` | totals, net flow, fees, daily series, top counterparties |
- Set `POLL_SECONDS` to re-sync every tracked wallet in the background.

### Frontend (`frontend/src`)
- **Dashboard.** Shows the live USDC balance, a gas warning, 30-day stats, a cash-flow chart, top counterparties and recent activity.
- **Send.** A guided checkout: Details → Review (fee, net amount, network) → Pay → Receipt. `usePayment` picks the lowest-friction path automatically:
  1. existing allowance → 1 tx
  2. EIP-2612 permit → 1 signature + 1 tx
  3. approve fallback for smart wallets or wallets without typed-data support
  4. plain USDC `transfer` when no router is configured
- **Receive.** Address QR code, plus payment links (`/pay?to=&amount=&memo=`) or on-chain invoices (`/pay?request=0x…`).
- **Pay.** A public checkout page for links and invoices. It reads the invoice's status (open, paid, cancelled or expired) from the chain.
- **History.** Received/sent filters, pagination and CSV export.
- **Wrong-network handling.** If the wallet is on another chain, the app shows a one-click switch to Base.

## Quick start (local chain)

```bash
# 1. Contracts: local chain, deploy, demo data
cd contracts && npm install
npx hardhat node                         # terminal 1
npm run deploy:local && npm run seed:local   # terminal 2 (prints addresses)

# 2. Backend
cd backend
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# .env: CHAIN_ID=31337, RPC_URL=http://127.0.0.1:8545, USDC_ADDRESS=..., ROUTER_ADDRESS=..., CONFIRMATIONS=0
uvicorn app.main:app --reload --port 8000

# 3. Frontend
cd frontend && npm install
# .env: VITE_CHAIN=localhost, VITE_USDC_ADDRESS=..., VITE_ROUTER_ADDRESS=...
npm run dev                              # http://localhost:5173
```

To try it in a browser wallet, add the network `http://127.0.0.1:8545` (chain ID 31337) and import one of the Hardhat test accounts printed by `npx hardhat node`. Those keys are public and for local use only. The seeded demo wallet is account #1.

## Base Sepolia

```bash
cd contracts && cp .env.example .env     # set DEPLOYER_PRIVATE_KEY (testnet key with Sepolia ETH)
npm run deploy:base-sepolia
```
Next, set `ROUTER_ADDRESS` in `backend/.env` and `VITE_ROUTER_ADDRESS` in `frontend/.env`. Both apps default to Base Sepolia and Circle's testnet USDC (`0x036C…CF7e`), which you can get from [faucet.circle.com](https://faucet.circle.com). For Base mainnet, use `CHAIN_ID=8453` / `VITE_CHAIN=base`.

Public RPCs rate-limit `eth_getLogs`. For real usage, set `RPC_URL` to an Alchemy, QuickNode or similar endpoint.

## Tests

```bash
cd contracts && npm test                        # 10 tests: payments, permit, front-run permit, fees, invoices
cd backend && .venv/Scripts/python -m pytest    # 6 tests: indexing, enrichment, idempotency, analytics, adaptive chunking
cd frontend && npm run typecheck
```
