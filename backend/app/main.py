import logging
import re
import threading
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .analytics import wallet_analytics, wallet_transfers_query
from .config import Settings, get_settings
from .db import Transfer, Wallet, make_session_factory
from .events import BALANCE_OF_SELECTOR, address_topic, to_usdc
from .indexer import Indexer
from .rpc import ChainReader, RpcClient, RpcError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("basepay")

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


# -- dependencies -------------------------------------------------------------

class State:
    session_factory = None
    rpc: ChainReader | None = None


def get_db():
    if State.session_factory is None:
        State.session_factory = make_session_factory(get_settings().database_url)
    db = State.session_factory()
    try:
        yield db
    finally:
        db.close()


def get_rpc() -> ChainReader:
    if State.rpc is None:
        State.rpc = RpcClient(get_settings().resolved_rpc_url)
    return State.rpc


def get_indexer(rpc: ChainReader = Depends(get_rpc), settings: Settings = Depends(get_settings)) -> Indexer:
    return Indexer(rpc, settings)


def wallet_address(address: str = Path(..., description="0x-prefixed wallet address")) -> str:
    if not ADDRESS_RE.match(address):
        raise HTTPException(400, "Invalid address")
    return address.lower()


# -- background polling -------------------------------------------------------

def _poll_loop(stop: threading.Event, settings: Settings) -> None:
    while not stop.wait(settings.poll_seconds):
        db = next(get_db())
        try:
            for r in Indexer(get_rpc(), settings).sync_all(db):
                if r.new_transfers:
                    log.info("indexed %s new transfers for %s", r.new_transfers, r.address)
        except Exception:  # keep the poller alive
            log.exception("poll loop error")
        finally:
            db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    stop = threading.Event()
    if settings.poll_seconds > 0:
        threading.Thread(target=_poll_loop, args=(stop, settings), daemon=True).start()
        log.info("background indexer polling every %ss", settings.poll_seconds)
    yield
    stop.set()


app = FastAPI(title="BasePay API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- schemas -----------------------------------------------------------------

class TransactionOut(BaseModel):
    tx_hash: str
    log_index: int
    block_number: int
    timestamp: int
    from_addr: str
    to_addr: str
    amount: float
    amount_raw: str
    direction: Literal["in", "out", "self"]
    kind: str
    memo: str | None
    ref: str | None
    payment_id: int | None
    fee: float | None


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    limit: int
    offset: int
    last_synced_block: int | None


def _to_out(row: Transfer, address: str) -> TransactionOut:
    if row.from_addr == row.to_addr:
        direction = "self"
    else:
        direction = "out" if row.from_addr == address else "in"
    return TransactionOut(
        tx_hash=row.tx_hash,
        log_index=row.log_index,
        block_number=row.block_number,
        timestamp=row.timestamp,
        from_addr=row.from_addr,
        to_addr=row.to_addr,
        amount=to_usdc(row.amount),
        amount_raw=str(row.amount),
        direction=direction,
        kind=row.kind,
        memo=row.memo,
        ref=row.ref,
        payment_id=row.payment_id,
        fee=to_usdc(row.fee) if row.fee is not None else None,
    )


# -- routes ------------------------------------------------------------------

@app.get("/api/health")
def health(settings: Settings = Depends(get_settings)):
    return {
        "status": "ok",
        "chain_id": settings.chain_id,
        "usdc_address": settings.resolved_usdc_address,
        "router_address": settings.router_address,
    }


@app.get("/api/wallets/{address}/balance")
def balance(
    address: str = Depends(wallet_address),
    rpc: ChainReader = Depends(get_rpc),
    settings: Settings = Depends(get_settings),
):
    try:
        data = BALANCE_OF_SELECTOR + address_topic(address)[2:]
        raw = int(rpc.eth_call(settings.resolved_usdc_address, data), 16)
        eth_wei = rpc.get_balance(address)
    except RpcError as exc:
        raise HTTPException(502, f"RPC error: {exc}")
    return {"address": address, "usdc": to_usdc(raw), "usdc_raw": str(raw), "eth": eth_wei / 10**18}


@app.post("/api/wallets/{address}/sync")
def sync(
    address: str = Depends(wallet_address),
    db: Session = Depends(get_db),
    indexer: Indexer = Depends(get_indexer),
):
    try:
        result = indexer.sync_wallet(db, address)
    except RpcError as exc:
        db.rollback()
        raise HTTPException(502, f"RPC error: {exc}")
    return {
        "address": result.address,
        "from_block": result.from_block,
        "to_block": result.to_block,
        "new_transfers": result.new_transfers,
    }


@app.get("/api/wallets/{address}/transactions", response_model=TransactionPage)
def transactions(
    address: str = Depends(wallet_address),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    direction: Literal["all", "in", "out"] = "all",
    kind: Literal["transfer", "payment", "fee"] | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    q = wallet_transfers_query(address, settings.chain_id)
    if direction == "in":
        q = q.where(Transfer.to_addr == address)
    elif direction == "out":
        q = q.where(Transfer.from_addr == address)
    if kind:
        q = q.where(Transfer.kind == kind)

    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(
        q.order_by(Transfer.block_number.desc(), Transfer.log_index.desc()).limit(limit).offset(offset)
    ).scalars()
    wallet = db.get(Wallet, address)
    return TransactionPage(
        items=[_to_out(r, address) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
        last_synced_block=wallet.last_synced_block if wallet else None,
    )


@app.get("/api/wallets/{address}/analytics")
def analytics(
    address: str = Depends(wallet_address),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return wallet_analytics(db, address, settings.chain_id, days)
