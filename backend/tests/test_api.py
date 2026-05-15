import time

import pytest
from eth_abi import encode
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.db import make_session_factory
from app.events import PAYMENT_SENT_TOPIC, TRANSFER_TOPIC, address_topic
from app.main import app, get_db, get_rpc
from app.rpc import RpcError

USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
ROUTER = "0x" + "ab" * 20
ALICE = "0x" + "a1" * 20
BOB = "0x" + "b0" * 20
CAROL = "0x" + "c4" * 20
TREASURY = "0x" + "fe" * 20
HEAD = 1_000


class FakeChain:
    """In-memory stand-in for a Base RPC node."""

    def __init__(self, max_range: int | None = None):
        self.logs: list[dict] = []
        self.max_range = max_range
        self.balances = {ALICE: 123_450_000}
        self._log_index = 0

    def _add(self, address, topics, data, block, tx):
        self._log_index += 1
        self.logs.append(
            {
                "address": address,
                "topics": topics,
                "data": data,
                "blockNumber": hex(block),
                "transactionHash": tx,
                "logIndex": hex(self._log_index),
            }
        )

    def transfer(self, frm, to, amount, block, tx):
        self._add(USDC, [TRANSFER_TOPIC, address_topic(frm), address_topic(to)], hex(amount), block, tx)

    def payment(self, pid, frm, to, amount, fee, memo, block, tx):
        ref = b"\x11" * 32
        data = "0x" + encode(["uint256", "uint256", "bytes32", "string"], [amount, fee, ref, memo]).hex()
        topics = [PAYMENT_SENT_TOPIC, "0x" + hex(pid)[2:].rjust(64, "0"), address_topic(frm), address_topic(to)]
        self._add(ROUTER, topics, data, block, tx)
        self.transfer(frm, to, amount - fee, block, tx)
        if fee:
            self.transfer(frm, TREASURY, fee, block, tx)

    # ChainReader interface
    def block_number(self):
        return HEAD

    def get_logs(self, address, topics, from_block, to_block):
        if self.max_range and to_block - from_block + 1 > self.max_range:
            raise RpcError("block range too large")
        out = []
        for entry in self.logs:
            if entry["address"] != address or not from_block <= int(entry["blockNumber"], 16) <= to_block:
                continue
            if all(t is None or (i < len(entry["topics"]) and entry["topics"][i] == t) for i, t in enumerate(topics)):
                out.append(entry)
        return out

    def block_timestamp(self, block_number):
        return int(time.time()) - (HEAD - block_number) * 2

    def eth_call(self, to, data):
        return hex(self.balances.get("0x" + data[-40:], 0))

    def get_balance(self, address):
        return 10**17


@pytest.fixture
def chain():
    return FakeChain()


@pytest.fixture
def client(chain, tmp_path):
    settings = Settings(
        chain_id=84532,
        router_address=ROUTER,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        initial_lookback_blocks=10_000,
        log_chunk_size=400,
        confirmations=0,
    )
    factory = make_session_factory(settings.database_url)

    def db_override():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_rpc] = lambda: chain
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_invalid_address(client):
    assert client.get("/api/wallets/0xnope/transactions").status_code == 400


def test_balance(client):
    body = client.get(f"/api/wallets/{ALICE}/balance").json()
    assert body["usdc"] == 123.45
    assert body["eth"] == 0.1


def test_sync_normalizes_router_payments_and_plain_transfers(client, chain):
    chain.transfer(CAROL, ALICE, 50_000_000, block=100, tx="0x" + "01" * 32)
    chain.payment(1, ALICE, BOB, 20_000_000, 100_000, "Dinner", block=200, tx="0x" + "02" * 32)
    chain.transfer(BOB, CAROL, 1, block=300, tx="0x" + "03" * 32)  # unrelated

    r = client.post(f"/api/wallets/{ALICE}/sync").json()
    assert r["new_transfers"] == 3

    page = client.get(f"/api/wallets/{ALICE}/transactions").json()
    assert page["total"] == 3
    assert page["last_synced_block"] == HEAD
    by_kind = {t["kind"]: t for t in page["items"]}
    assert by_kind["payment"]["memo"] == "Dinner"
    assert by_kind["payment"]["amount"] == 19.9
    assert by_kind["payment"]["direction"] == "out"
    assert by_kind["payment"]["payment_id"] == 1
    assert by_kind["fee"]["amount"] == 0.1
    assert by_kind["transfer"]["direction"] == "in"

    # re-sync is idempotent
    assert client.post(f"/api/wallets/{ALICE}/sync").json()["new_transfers"] == 0

    outgoing = client.get(f"/api/wallets/{ALICE}/transactions?direction=out").json()
    assert outgoing["total"] == 2


def test_analytics(client, chain):
    chain.transfer(CAROL, ALICE, 50_000_000, block=100, tx="0x" + "01" * 32)
    chain.payment(1, ALICE, BOB, 20_000_000, 100_000, "Dinner", block=200, tx="0x" + "02" * 32)
    chain.payment(2, ALICE, BOB, 10_000_000, 50_000, "", block=210, tx="0x" + "04" * 32)
    client.post(f"/api/wallets/{ALICE}/sync")

    a = client.get(f"/api/wallets/{ALICE}/analytics?days=7").json()
    s = a["summary"]
    assert s["total_in"] == 50
    assert s["total_out"] == 30
    assert s["net_flow"] == 20
    assert s["fees_paid"] == 0.15
    assert s["sent_count"] == 2
    assert s["unique_counterparties"] == 2
    assert a["top_counterparties"][0]["address"] == CAROL
    assert len(a["daily"]) == 7
    assert sum(d["inflow"] for d in a["daily"]) == 50


def test_mints_are_not_counterparties(client, chain):
    chain.transfer("0x" + "0" * 40, ALICE, 5_000_000, block=100, tx="0x" + "06" * 32)
    client.post(f"/api/wallets/{ALICE}/sync")
    a = client.get(f"/api/wallets/{ALICE}/analytics").json()
    assert a["summary"]["total_in"] == 5
    assert a["top_counterparties"] == []


def test_indexer_shrinks_chunk_on_range_errors(client, chain):
    chain.max_range = 150
    chain.transfer(CAROL, ALICE, 1_000_000, block=999, tx="0x" + "05" * 32)
    assert client.post(f"/api/wallets/{ALICE}/sync").json()["new_transfers"] == 1
