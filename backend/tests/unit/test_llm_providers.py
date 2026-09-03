"""Provider-layer tests: request shape, cost attribution, error mapping.

No network. Each test swaps in an httpx.MockTransport so we assert on the
exact request the provider builds and on how it reads the response back.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.agents.llm import (
    AnthropicProvider,
    LLMError,
    OpenAIProvider,
    OpenRouterProvider,
    build_provider,
)


def _patch_transport(monkeypatch: pytest.MonkeyPatch, handler: Any) -> dict[str, Any]:
    """Route every AsyncClient in the llm module through `handler`."""
    seen: dict[str, Any] = {}

    def capture(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["json"] = httpx.Request("POST", request.url, content=request.content).content.decode()
        return handler(request)

    original = httpx.AsyncClient

    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(capture)
        return original(*args, **kwargs)

    monkeypatch.setattr("app.agents.llm.httpx.AsyncClient", factory)
    return seen


def _openrouter_body(cost: float | None) -> dict[str, Any]:
    usage: dict[str, Any] = {"prompt_tokens": 100, "completion_tokens": 20}
    if cost is not None:
        usage["cost"] = cost
    return {"choices": [{"message": {"content": "hello"}}], "usage": usage}


async def test_openrouter_targets_openrouter_and_sends_bearer_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _patch_transport(
        monkeypatch, lambda r: httpx.Response(200, json=_openrouter_body(0.0042))
    )
    provider = OpenRouterProvider(api_key="sk-or-v1-test", model="anthropic/claude-sonnet-4.5")

    response = await provider.generate(system="sys", prompt="hi")

    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert seen["headers"]["authorization"] == "Bearer sk-or-v1-test"
    assert '"anthropic/claude-sonnet-4.5"' in seen["json"]
    assert response.text == "hello"


async def test_openrouter_prefers_the_cost_the_gateway_reports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_transport(monkeypatch, lambda r: httpx.Response(200, json=_openrouter_body(0.0042)))
    provider = OpenRouterProvider(api_key="k", model="anthropic/claude-sonnet-4.5")

    usage = (await provider.generate(system="s", prompt="p")).usage

    # Not the local price table -- that has no entry for a namespaced slug.
    assert usage.cost_usd == 0.0042
    assert usage.input_tokens == 100


async def test_openrouter_falls_back_to_estimate_when_cost_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_transport(monkeypatch, lambda r: httpx.Response(200, json=_openrouter_body(None)))
    # A slug absent from _PRICING estimates to zero rather than guessing.
    provider = OpenRouterProvider(api_key="k", model="anthropic/claude-sonnet-4.5")

    assert (await provider.generate(system="s", prompt="p")).usage.cost_usd == 0.0


async def test_openrouter_200_with_error_body_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """A gateway can answer 200 with an error payload and no `choices`."""
    _patch_transport(
        monkeypatch,
        lambda r: httpx.Response(200, json={"error": {"message": "no credits"}}),
    )
    provider = OpenRouterProvider(api_key="k", model="anthropic/claude-sonnet-4.5")

    with pytest.raises(LLMError) as exc:
        await provider.generate(system="s", prompt="p")
    assert "no credits" in str(exc.value)


@pytest.mark.parametrize(
    ("status", "code"),
    [(429, "LLM_RATE_LIMITED"), (401, "LLM_ERROR"), (500, "LLM_ERROR")],
)
async def test_openrouter_maps_http_errors(
    monkeypatch: pytest.MonkeyPatch, status: int, code: str
) -> None:
    _patch_transport(monkeypatch, lambda r: httpx.Response(status, json={}))
    provider = OpenRouterProvider(api_key="k", model="anthropic/claude-sonnet-4.5")

    with pytest.raises(LLMError) as exc:
        await provider.generate(system="s", prompt="p")
    assert exc.value.code == code


async def test_http_error_surfaces_the_providers_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bare status code costs a debugging round-trip; the body says why."""
    _patch_transport(
        monkeypatch,
        lambda r: httpx.Response(
            402, json={"error": {"message": "Insufficient credits to run this request."}}
        ),
    )
    provider = OpenRouterProvider(api_key="k", model="anthropic/claude-sonnet-4.5")

    with pytest.raises(LLMError) as exc:
        await provider.generate(system="s", prompt="p")
    assert "402" in str(exc.value)
    assert "Insufficient credits" in str(exc.value)


async def test_http_error_with_non_json_body_does_not_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_transport(monkeypatch, lambda r: httpx.Response(502, text="<html>bad gateway</html>"))
    provider = OpenRouterProvider(api_key="k", model="anthropic/claude-sonnet-4.5")

    with pytest.raises(LLMError) as exc:
        await provider.generate(system="s", prompt="p")
    assert exc.value.code == "LLM_ERROR"
    assert "bad gateway" in str(exc.value)


async def test_openai_still_targets_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    """The refactor for OpenRouter must not move the OpenAI provider."""
    seen = _patch_transport(monkeypatch, lambda r: httpx.Response(200, json=_openrouter_body(None)))
    provider = OpenAIProvider(api_key="sk-test", model="gpt-4o")

    await provider.generate(system="s", prompt="p")

    assert seen["url"] == "https://api.openai.com/v1/chat/completions"
    # OpenAI has no `usage.include` field; sending it would be rejected.
    assert '"usage"' not in seen["json"]


async def test_openai_cost_still_uses_the_price_table(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_transport(monkeypatch, lambda r: httpx.Response(200, json=_openrouter_body(None)))
    provider = OpenAIProvider(api_key="k", model="gpt-4o")

    usage = (await provider.generate(system="s", prompt="p")).usage

    assert usage.cost_usd == pytest.approx((100 * 2.5 + 20 * 10.0) / 1_000_000)


async def test_anthropic_unaffected(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _patch_transport(
        monkeypatch,
        lambda r: httpx.Response(
            200,
            json={
                "content": [{"text": "hi"}],
                "usage": {"input_tokens": 5, "output_tokens": 2},
            },
        ),
    )
    provider = AnthropicProvider(api_key="sk-ant", model="claude-sonnet-5")

    assert (await provider.generate(system="s", prompt="p")).text == "hi"
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["headers"]["x-api-key"] == "sk-ant"


def test_build_provider_returns_openrouter() -> None:
    provider = build_provider(
        provider="openrouter", model="anthropic/claude-sonnet-4.5", api_key="k"
    )
    assert isinstance(provider, OpenRouterProvider)
    assert provider.model == "anthropic/claude-sonnet-4.5"


def test_build_provider_openrouter_requires_a_key() -> None:
    with pytest.raises(ValueError, match="LLM_API_KEY"):
        build_provider(provider="openrouter", model="anthropic/claude-sonnet-4.5", api_key=None)
