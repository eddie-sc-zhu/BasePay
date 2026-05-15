"""Minimal JSON-RPC client for the handful of Base calls the indexer needs."""

import itertools
from typing import Any, Protocol

import httpx


class RpcError(Exception):
    pass


class ChainReader(Protocol):
    def block_number(self) -> int: ...
    def get_logs(self, address: str, topics: list[str | None], from_block: int, to_block: int) -> list[dict]: ...
    def block_timestamp(self, block_number: int) -> int: ...
    def eth_call(self, to: str, data: str) -> str: ...
    def get_balance(self, address: str) -> int: ...


class RpcClient:
    def __init__(self, url: str, timeout: float = 20.0):
        self._client = httpx.Client(timeout=timeout)
        self._url = url
        self._ids = itertools.count(1)
        self._ts_cache: dict[int, int] = {}

    def _call(self, method: str, params: list[Any]) -> Any:
        try:
            resp = self._client.post(
                self._url, json={"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params}
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise RpcError(f"{method}: {exc}") from exc
        body = resp.json()
        if "error" in body:
            raise RpcError(f"{method}: {body['error']}")
        return body["result"]

    def block_number(self) -> int:
        return int(self._call("eth_blockNumber", []), 16)

    def get_logs(self, address: str, topics: list[str | None], from_block: int, to_block: int) -> list[dict]:
        return self._call(
            "eth_getLogs",
            [{"address": address, "topics": topics, "fromBlock": hex(from_block), "toBlock": hex(to_block)}],
        )

    def block_timestamp(self, block_number: int) -> int:
        if block_number not in self._ts_cache:
            block = self._call("eth_getBlockByNumber", [hex(block_number), False])
            self._ts_cache[block_number] = int(block["timestamp"], 16)
        return self._ts_cache[block_number]

    def eth_call(self, to: str, data: str) -> str:
        return self._call("eth_call", [{"to": to, "data": data}, "latest"])

    def get_balance(self, address: str) -> int:
        return int(self._call("eth_getBalance", [address, "latest"]), 16)
