"""Event signatures and decoders for USDC + BasePayRouter logs."""

from dataclasses import dataclass

from eth_abi import decode
from eth_hash.auto import keccak

USDC_DECIMALS = 6
BALANCE_OF_SELECTOR = "0x70a08231"


def topic_for(signature: str) -> str:
    return "0x" + keccak(signature.encode()).hex()


TRANSFER_TOPIC = topic_for("Transfer(address,address,uint256)")
PAYMENT_SENT_TOPIC = topic_for("PaymentSent(uint256,address,address,uint256,uint256,bytes32,string)")


def address_topic(address: str) -> str:
    return "0x" + address.lower().removeprefix("0x").rjust(64, "0")


def topic_to_address(topic: str) -> str:
    return "0x" + topic[-40:].lower()


def log_key(log: dict) -> tuple[str, int]:
    return log["transactionHash"].lower(), int(log["logIndex"], 16)


@dataclass(frozen=True)
class TransferLog:
    tx_hash: str
    log_index: int
    block_number: int
    from_addr: str
    to_addr: str
    amount: int


@dataclass(frozen=True)
class PaymentLog:
    tx_hash: str
    payment_id: int
    from_addr: str
    to_addr: str
    amount: int
    fee: int
    ref: str
    memo: str


def decode_transfer(log: dict) -> TransferLog:
    tx_hash, log_index = log_key(log)
    return TransferLog(
        tx_hash=tx_hash,
        log_index=log_index,
        block_number=int(log["blockNumber"], 16),
        from_addr=topic_to_address(log["topics"][1]),
        to_addr=topic_to_address(log["topics"][2]),
        amount=int(log["data"], 16),
    )


def decode_payment(log: dict) -> PaymentLog:
    amount, fee, ref, memo = decode(["uint256", "uint256", "bytes32", "string"], bytes.fromhex(log["data"][2:]))
    return PaymentLog(
        tx_hash=log["transactionHash"].lower(),
        payment_id=int(log["topics"][1], 16),
        from_addr=topic_to_address(log["topics"][2]),
        to_addr=topic_to_address(log["topics"][3]),
        amount=amount,
        fee=fee,
        ref="0x" + ref.hex(),
        memo=memo,
    )


def to_usdc(units: int) -> float:
    return round(units / 10**USDC_DECIMALS, USDC_DECIMALS)
