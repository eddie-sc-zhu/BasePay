from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class Wallet(Base):
    __tablename__ = "wallets"

    address: Mapped[str] = mapped_column(String(42), primary_key=True)
    last_synced_block: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Transfer(Base):
    """A normalized USDC movement, enriched with BasePay router metadata when present."""

    __tablename__ = "transfers"
    __table_args__ = (
        UniqueConstraint("chain_id", "tx_hash", "log_index", name="uq_transfer_log"),
        Index("ix_transfers_from", "from_addr", "block_number"),
        Index("ix_transfers_to", "to_addr", "block_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chain_id: Mapped[int] = mapped_column(Integer)
    tx_hash: Mapped[str] = mapped_column(String(66))
    log_index: Mapped[int] = mapped_column(Integer)
    block_number: Mapped[int] = mapped_column(BigInteger)
    timestamp: Mapped[int] = mapped_column(BigInteger)
    from_addr: Mapped[str] = mapped_column(String(42))
    to_addr: Mapped[str] = mapped_column(String(42))
    amount: Mapped[int] = mapped_column(BigInteger)  # USDC base units (6 decimals)
    kind: Mapped[str] = mapped_column(String(16), default="transfer")  # transfer | payment | fee
    memo: Mapped[str | None] = mapped_column(String(280), nullable=True)
    ref: Mapped[str | None] = mapped_column(String(66), nullable=True)
    payment_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    fee: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


def make_session_factory(database_url: str) -> sessionmaker:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, connect_args=connect_args)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)
