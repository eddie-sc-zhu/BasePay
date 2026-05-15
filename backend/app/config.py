from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Circle's native USDC on Base
USDC_BY_CHAIN = {
    8453: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    84532: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
}
DEFAULT_RPC_BY_CHAIN = {
    8453: "https://mainnet.base.org",
    84532: "https://sepolia.base.org",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    chain_id: int = 84532
    rpc_url: str | None = None
    usdc_address: str | None = None
    router_address: str | None = None
    database_url: str = "sqlite:///./basepay.db"

    # Indexer tuning
    log_chunk_size: int = 5_000
    initial_lookback_blocks: int = 50_000  # ~28h of Base blocks on first sync
    confirmations: int = 2
    poll_seconds: int = 0  # >0 enables background re-sync of tracked wallets

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("usdc_address", "router_address", mode="before")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return v.lower() if v else None

    @property
    def resolved_rpc_url(self) -> str:
        return self.rpc_url or DEFAULT_RPC_BY_CHAIN.get(self.chain_id, "http://127.0.0.1:8545")

    @property
    def resolved_usdc_address(self) -> str:
        addr = self.usdc_address or USDC_BY_CHAIN.get(self.chain_id)
        if not addr:
            raise RuntimeError(f"No USDC address known for chain {self.chain_id}; set USDC_ADDRESS")
        return addr


@lru_cache
def get_settings() -> Settings:
    return Settings()
