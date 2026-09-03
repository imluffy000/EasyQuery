"""LLM provider abstraction.

The rest of the application depends on `LLMProvider`, never on a vendor SDK.
Two capabilities are exposed:

* `generate` -- free text, used only for the final natural-language answer.
* `structured_generate` -- returns validated JSON matching a Pydantic model.
  Every decision that feeds back into the pipeline (query plan, ambiguity
  verdict, SQL) goes through this, because free-form prose from a model is not
  a control signal we can safely branch on.

`EchoProvider` makes the whole pipeline runnable and testable without an API
key or network access -- it is what the integration tests and `make dev`
use by default.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, TypeVar

import httpx
import structlog
from pydantic import BaseModel, ValidationError

log = structlog.get_logger(__name__)

T = TypeVar("T", bound=BaseModel)


@dataclass
class LLMUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    model: str = ""
    latency_ms: int = 0


@dataclass
class LLMResponse:
    text: str
    usage: LLMUsage = field(default_factory=LLMUsage)


class LLMError(Exception):
    def __init__(self, message: str, *, code: str = "LLM_ERROR") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# Per-million-token pricing, used for cost attribution in the analytics view.
# Kept in one place so a price change is a one-line edit.
_PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-5": (15.0, 75.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
    "gpt-4o": (2.5, 10.0),
    "gpt-4o-mini": (0.15, 0.6),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rate_in, rate_out = _PRICING.get(model, (0.0, 0.0))
    return (input_tokens * rate_in + output_tokens * rate_out) / 1_000_000


class LLMProvider(ABC):
    """Vendor-neutral model access."""

    def __init__(self, *, model: str, timeout_seconds: int = 60, max_tokens: int = 4096) -> None:
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_tokens = max_tokens

    @abstractmethod
    async def generate(
        self, *, system: str, prompt: str, temperature: float = 0.0
    ) -> LLMResponse: ...

    async def structured_generate(
        self,
        *,
        system: str,
        prompt: str,
        schema: type[T],
        temperature: float = 0.0,
        retries: int = 1,
    ) -> tuple[T, LLMUsage]:
        """Generate and validate JSON against `schema`.

        One repair attempt is allowed: models occasionally wrap JSON in prose
        or emit a trailing comma. Beyond that we fail loudly rather than
        guessing at the model's intent.
        """
        instruction = (
            f"{system}\n\n"
            "Respond with a single JSON object and nothing else. No markdown "
            "fence, no commentary. It must validate against this JSON schema:\n"
            f"{json.dumps(schema.model_json_schema(), indent=2)}"
        )

        last_error: str = ""
        attempt_prompt = prompt

        for attempt in range(retries + 1):
            response = await self.generate(
                system=instruction, prompt=attempt_prompt, temperature=temperature
            )
            raw = _extract_json(response.text)
            if raw is not None:
                try:
                    return schema.model_validate(raw), response.usage
                except ValidationError as exc:
                    last_error = str(exc)
            else:
                last_error = "No JSON object was found in the response."

            log.warning(
                "structured_generate_retry",
                attempt=attempt + 1,
                schema=schema.__name__,
                error=last_error[:200],
            )
            attempt_prompt = (
                f"{prompt}\n\nYour previous response was rejected:\n{last_error}\n"
                "Return only valid JSON matching the schema."
            )

        raise LLMError(
            f"Model did not return valid {schema.__name__} JSON: {last_error[:300]}",
            code="LLM_INVALID_OUTPUT",
        )


def _extract_json(text: str) -> dict[str, Any] | None:
    """Pull a JSON object out of a model response, tolerating light wrapping."""
    text = text.strip()
    if not text:
        return None

    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    # Fall back to the outermost balanced {...}.
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


class AnthropicProvider(LLMProvider):
    API_URL = "https://api.anthropic.com/v1/messages"
    API_VERSION = "2023-06-01"

    def __init__(self, *, api_key: str, model: str = "claude-sonnet-5", **kwargs: Any) -> None:
        super().__init__(model=model, **kwargs)
        self._api_key = api_key

    async def generate(self, *, system: str, prompt: str, temperature: float = 0.0) -> LLMResponse:
        import time

        started = time.perf_counter()
        payload = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    self.API_URL,
                    headers={
                        "x-api-key": self._api_key,
                        "anthropic-version": self.API_VERSION,
                        "content-type": "application/json",
                    },
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise LLMError("The model timed out.", code="LLM_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise LLMError("The model could not be reached.", code="LLM_UNREACHABLE") from exc

        if response.status_code == 429:
            raise LLMError("Model rate limit reached.", code="LLM_RATE_LIMITED")
        if response.status_code >= 400:
            raise LLMError(f"Model returned {response.status_code}.", code="LLM_ERROR")

        body = response.json()
        text = "".join(block.get("text", "") for block in body.get("content", []))
        usage_block = body.get("usage", {})
        input_tokens = int(usage_block.get("input_tokens", 0))
        output_tokens = int(usage_block.get("output_tokens", 0))

        return LLMResponse(
            text=text,
            usage=LLMUsage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=estimate_cost(self.model, input_tokens, output_tokens),
                model=self.model,
                latency_ms=int((time.perf_counter() - started) * 1000),
            ),
        )


class OpenAIProvider(LLMProvider):
    API_URL = "https://api.openai.com/v1/chat/completions"

    def __init__(self, *, api_key: str, model: str = "gpt-4o", **kwargs: Any) -> None:
        super().__init__(model=model, **kwargs)
        self._api_key = api_key

    async def generate(self, *, system: str, prompt: str, temperature: float = 0.0) -> LLMResponse:
        import time

        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    self.API_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "content-type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "max_tokens": self.max_tokens,
                        "temperature": temperature,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": prompt},
                        ],
                    },
                )
        except httpx.TimeoutException as exc:
            raise LLMError("The model timed out.", code="LLM_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise LLMError("The model could not be reached.", code="LLM_UNREACHABLE") from exc

        if response.status_code >= 400:
            raise LLMError(f"Model returned {response.status_code}.", code="LLM_ERROR")

        body = response.json()
        text = body["choices"][0]["message"]["content"] or ""
        usage_block = body.get("usage", {})
        input_tokens = int(usage_block.get("prompt_tokens", 0))
        output_tokens = int(usage_block.get("completion_tokens", 0))

        return LLMResponse(
            text=text,
            usage=LLMUsage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=estimate_cost(self.model, input_tokens, output_tokens),
                model=self.model,
                latency_ms=int((time.perf_counter() - started) * 1000),
            ),
        )


class EchoProvider(LLMProvider):
    """Deterministic offline provider.

    It produces schema-shaped JSON for each structured call so the full
    LangGraph pipeline -- including SQL validation, EXPLAIN gating and
    execution -- can run in CI with no API key and no network. It is not a
    fake *result*: the SQL it emits is really validated and really executed
    against the seeded test database.
    """

    def __init__(
        self,
        *,
        model: str = "echo",
        sql: str = "SELECT 1 AS result",
        correction_sql: str | None = None,
        **kwargs: Any,
    ) -> None:
        kwargs.pop("api_key", None)
        super().__init__(model=model, **kwargs)
        # Tests override these to drive a specific path through the graph
        # (a blocked statement, a column that does not exist, and so on).
        self.sql = sql
        self.correction_sql = correction_sql or sql
        self.calls: list[tuple[str, str]] = []

    async def generate(self, *, system: str, prompt: str, temperature: float = 0.0) -> LLMResponse:
        self.calls.append((system, prompt))
        return LLMResponse(
            text=json.dumps(self._respond(system, prompt)),
            usage=LLMUsage(input_tokens=0, output_tokens=0, model=self.model),
        )

    def _respond(self, system: str, prompt: str) -> dict[str, Any]:
        # Dispatch on a phrase unique to each stage prompt. Substring-matching
        # on "sql" would be wrong: several prompts mention SQL in passing.
        if "Write the final answer" in system:
            return {"answer": "Offline echo provider is active; no model was called."}
        if "Choose how to present a result set" in system:
            return {"type": "table", "x": None, "y": None, "title": "Result"}
        if "Decide whether the question can be answered" in system:
            return {"is_ambiguous": False, "dimension": None, "question": None, "options": []}
        if "structured query plan" in system:
            return {
                "intent": "aggregate",
                "metrics": ["count"],
                "dimensions": [],
                "filters": [],
                "time_range": None,
                "tables": [],
                "sort": None,
                "limit": 100,
                "assumptions": ["Offline echo provider: placeholder plan."],
            }
        if "Your previous SQL failed" in system:
            return {
                "sql": self.correction_sql,
                "tables_used": [],
                "assumptions": ["Offline echo provider: corrected placeholder."],
                "needs_clarification": False,
            }
        if "read-only SQL statement" in system:
            return {
                "sql": self.sql,
                "tables_used": [],
                "assumptions": ["Offline echo provider: this is a placeholder query."],
                "needs_clarification": False,
            }
        if "Classify what the user is asking" in system:
            return {"intent": "aggregate", "entities": [], "reasoning_summary": "echo"}
        return {"answer": "Offline echo provider is active; no model was called."}


def build_provider(
    *,
    provider: str,
    model: str,
    api_key: str | None,
    timeout_seconds: int = 60,
    max_tokens: int = 4096,
) -> LLMProvider:
    """Construct the configured provider. Unknown names fail fast."""
    match provider:
        case "anthropic":
            if not api_key:
                raise ValueError("LLM_API_KEY is required for the anthropic provider.")
            return AnthropicProvider(
                api_key=api_key,
                model=model,
                timeout_seconds=timeout_seconds,
                max_tokens=max_tokens,
            )
        case "openai":
            if not api_key:
                raise ValueError("LLM_API_KEY is required for the openai provider.")
            return OpenAIProvider(
                api_key=api_key,
                model=model,
                timeout_seconds=timeout_seconds,
                max_tokens=max_tokens,
            )
        case "echo":
            return EchoProvider(timeout_seconds=timeout_seconds, max_tokens=max_tokens)
        case _:
            raise ValueError(f"Unknown LLM provider '{provider}'.")
