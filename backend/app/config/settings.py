"""Application configuration.

All settings come from the environment. Nothing here carries a usable default
for a secret -- production start-up fails loudly instead of running on a
guessable key (see `validate_production`).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "staging", "production"]


class QueryLimits(BaseSettings):
    """Guardrails applied to every query against a *user* database.

    These are workspace/database-overridable at runtime; the values here are
    the ceiling a workspace may not exceed.
    """

    max_execution_time_seconds: int = 30
    max_rows: int = 10_000
    max_result_size_mb: int = 10
    max_joins: int = 10
    require_limit_for_large_queries: bool = True
    # EXPLAIN cost above which we stop and ask the user before executing.
    cost_warning_threshold: float = 1_000_000.0


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    app_env: Environment = "development"
    app_name: str = "AI Database Copilot"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False

    # --- Core infrastructure -------------------------------------------------
    database_url: PostgresDsn
    redis_url: RedisDsn

    # --- Secrets -------------------------------------------------------------
    # ENCRYPTION_KEY protects stored user-database credentials at rest.
    encryption_key: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14

    # --- LLM -----------------------------------------------------------------
    llm_provider: Literal["anthropic", "openai", "openrouter", "echo"] = "anthropic"
    llm_model: str = "claude-sonnet-5"
    llm_api_key: str | None = None
    llm_timeout_seconds: int = 60
    llm_max_output_tokens: int = 4096

    # --- HTTP ----------------------------------------------------------------
    # NoDecode stops pydantic-settings from JSON-parsing the env var before the
    # validator below runs, so a plain comma-separated list works:
    #   CORS_ORIGINS=http://localhost:5173,https://app.example.com
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    # --- Guardrails ----------------------------------------------------------
    query: QueryLimits = Field(default_factory=QueryLimits)
    rate_limit_per_minute: int = 30
    # Hard cap on agent SQL-regeneration attempts (spec section 15).
    max_sql_retries: int = 2
    max_agent_steps: int = 25

    # --- Observability -------------------------------------------------------
    otel_endpoint: str | None = None
    otel_service_name: str = "db-copilot-backend"
    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            # Accept a JSON array too, so both styles work in a .env file.
            text = v.strip()
            if text.startswith("["):
                import json

                return json.loads(text)
            return [o.strip() for o in text.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    def validate_production(self) -> None:
        """Fail fast on unsafe production configuration."""
        if not self.is_production:
            return
        problems: list[str] = []
        if self.debug:
            problems.append("DEBUG must be false in production")
        if len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET must be at least 32 characters")
        if "*" in self.cors_origins:
            problems.append("CORS_ORIGINS must not be a wildcard in production")
        if self.llm_provider != "echo" and not self.llm_api_key:
            problems.append("LLM_API_KEY is required")
        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    settings = Settings()  # type: ignore[call-arg]
    settings.validate_production()
    return settings
