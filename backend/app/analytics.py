from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .db import Transfer
from .events import to_usdc

ZERO_ADDRESS = "0x" + "0" * 40


def wallet_transfers_query(address: str, chain_id: int):
    return select(Transfer).where(
        Transfer.chain_id == chain_id,
        or_(Transfer.from_addr == address, Transfer.to_addr == address),
    )


def wallet_analytics(db: Session, address: str, chain_id: int, days: int = 30) -> dict:
    rows = db.execute(wallet_transfers_query(address, chain_id)).scalars().all()

    total_in = total_out = fees_paid = 0
    largest_out = 0
    sent_count = received_count = 0
    counterparties: dict[str, dict] = defaultdict(lambda: {"volume": 0, "count": 0, "sent": 0, "received": 0})

    today = datetime.now(timezone.utc).date()
    first_day = today - timedelta(days=days - 1)
    daily = {first_day + timedelta(days=i): {"inflow": 0, "outflow": 0} for i in range(days)}

    for r in rows:
        day = datetime.fromtimestamp(r.timestamp, timezone.utc).date()
        outgoing = r.from_addr == address
        incoming = r.to_addr == address

        if outgoing:
            total_out += r.amount
            if r.kind == "fee":
                fees_paid += r.amount
            else:
                sent_count += 1
                largest_out = max(largest_out, r.amount)
            if day in daily:
                daily[day]["outflow"] += r.amount
        if incoming:
            total_in += r.amount
            received_count += 1
            if day in daily:
                daily[day]["inflow"] += r.amount

        other = r.to_addr if outgoing else r.from_addr
        if r.kind != "fee" and outgoing != incoming and other != ZERO_ADDRESS:  # skip mints / burns
            cp = counterparties[other]
            cp["volume"] += r.amount
            cp["count"] += 1
            cp["sent" if outgoing else "received"] += r.amount

    top = sorted(counterparties.items(), key=lambda kv: kv[1]["volume"], reverse=True)[:5]
    payments_out = total_out - fees_paid
    return {
        "address": address,
        "summary": {
            "total_in": to_usdc(total_in),
            "total_out": to_usdc(total_out),
            "net_flow": to_usdc(total_in - total_out),
            "fees_paid": to_usdc(fees_paid),
            "tx_count": len(rows),
            "sent_count": sent_count,
            "received_count": received_count,
            "avg_sent": to_usdc(payments_out // sent_count) if sent_count else 0.0,
            "largest_sent": to_usdc(largest_out),
            "unique_counterparties": len(counterparties),
        },
        "daily": [
            {"date": d.isoformat(), "inflow": to_usdc(v["inflow"]), "outflow": to_usdc(v["outflow"])}
            for d, v in daily.items()
        ],
        "top_counterparties": [
            {
                "address": addr,
                "volume": to_usdc(v["volume"]),
                "count": v["count"],
                "sent": to_usdc(v["sent"]),
                "received": to_usdc(v["received"]),
            }
            for addr, v in top
        ],
    }
