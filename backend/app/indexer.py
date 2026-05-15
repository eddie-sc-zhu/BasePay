"""Indexes USDC activity for tracked wallets and normalizes it into `transfers` rows.

USDC `Transfer` logs are the source of truth for value movement. When a transfer
was routed through BasePayRouter, the matching `PaymentSent` log in the same tx
enriches it with memo / reference / payment id, and the fee leg is tagged.
"""

import logging
import threading
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .db import Transfer, Wallet
from .events import (
    PAYMENT_SENT_TOPIC,
    TRANSFER_TOPIC,
    PaymentLog,
    TransferLog,
    address_topic,
    decode_payment,
    decode_transfer,
    log_key,
)
from .rpc import ChainReader, RpcError

log = logging.getLogger("basepay.indexer")
_sync_lock = threading.Lock()


@dataclass
class SyncResult:
    address: str
    from_block: int
    to_block: int
    new_transfers: int


class Indexer:
    def __init__(self, rpc: ChainReader, settings: Settings):
        self.rpc = rpc
        self.settings = settings
        self.usdc = settings.resolved_usdc_address
        self.router = settings.router_address

    # -- public ------------------------------------------------------------

    def sync_wallet(self, db: Session, address: str) -> SyncResult:
        address = address.lower()
        with _sync_lock:
            wallet = db.get(Wallet, address)
            if wallet is None:
                wallet = Wallet(address=address)
                db.add(wallet)

            head = self.rpc.block_number() - self.settings.confirmations
            start = (
                wallet.last_synced_block + 1
                if wallet.last_synced_block is not None
                else max(0, head - self.settings.initial_lookback_blocks)
            )
            if start > head:
                db.commit()
                return SyncResult(address, start, head, 0)

            inserted = 0
            cursor = start
            chunk = self.settings.log_chunk_size
            while cursor <= head:
                end = min(cursor + chunk - 1, head)
                try:
                    transfers, payments = self._fetch_range(address, cursor, end)
                except RpcError as exc:
                    if chunk > 1:
                        chunk = max(1, chunk // 2)
                        log.warning("getLogs failed for %s-%s (%s); shrinking chunk to %s", cursor, end, exc, chunk)
                        continue
                    raise
                inserted += self._store(db, transfers, payments)
                wallet.last_synced_block = end
                db.commit()
                cursor = end + 1

            return SyncResult(address, start, head, inserted)

    def sync_all(self, db: Session) -> list[SyncResult]:
        results = []
        for (address,) in db.execute(select(Wallet.address)).all():
            try:
                results.append(self.sync_wallet(db, address))
            except RpcError as exc:
                db.rollback()
                log.error("sync failed for %s: %s", address, exc)
        return results

    # -- internals ---------------------------------------------------------

    def _fetch_range(self, address: str, start: int, end: int) -> tuple[list[TransferLog], list[PaymentLog]]:
        me = address_topic(address)
        raw = {}
        for topics in ([TRANSFER_TOPIC, me], [TRANSFER_TOPIC, None, me]):
            for entry in self.rpc.get_logs(self.usdc, topics, start, end):
                raw[log_key(entry)] = entry
        transfers = [decode_transfer(entry) for entry in raw.values()]

        payments: list[PaymentLog] = []
        if self.router and transfers:
            raw_payments = {}
            for topics in ([PAYMENT_SENT_TOPIC, None, me], [PAYMENT_SENT_TOPIC, None, None, me]):
                for entry in self.rpc.get_logs(self.router, topics, start, end):
                    raw_payments[log_key(entry)] = entry
            payments = [decode_payment(entry) for entry in raw_payments.values()]
        return transfers, payments

    def _store(self, db: Session, transfers: list[TransferLog], payments: list[PaymentLog]) -> int:
        if not transfers:
            return 0

        chain_id = self.settings.chain_id
        existing = set(
            db.execute(
                select(Transfer.tx_hash, Transfer.log_index).where(
                    Transfer.chain_id == chain_id, Transfer.tx_hash.in_({t.tx_hash for t in transfers})
                )
            ).all()
        )
        payments_by_tx: dict[str, list[PaymentLog]] = defaultdict(list)
        for p in payments:
            payments_by_tx[p.tx_hash].append(p)

        inserted = 0
        for t in sorted(transfers, key=lambda t: (t.block_number, t.log_index)):
            if (t.tx_hash, t.log_index) in existing:
                continue
            row = Transfer(
                chain_id=chain_id,
                tx_hash=t.tx_hash,
                log_index=t.log_index,
                block_number=t.block_number,
                timestamp=self.rpc.block_timestamp(t.block_number),
                from_addr=t.from_addr,
                to_addr=t.to_addr,
                amount=t.amount,
                kind="transfer",
            )
            self._enrich(row, t, payments_by_tx.get(t.tx_hash, []))
            db.add(row)
            inserted += 1
        return inserted

    @staticmethod
    def _enrich(row: Transfer, t: TransferLog, payments: list[PaymentLog]) -> None:
        for p in payments:
            if p.from_addr != t.from_addr:
                continue
            if p.to_addr == t.to_addr and t.amount == p.amount - p.fee:
                row.kind = "payment"
            elif p.fee and t.amount == p.fee and p.to_addr != t.to_addr:
                row.kind = "fee"
            else:
                continue
            row.memo = p.memo or None
            row.ref = p.ref
            row.payment_id = p.payment_id
            row.fee = p.fee
            return
