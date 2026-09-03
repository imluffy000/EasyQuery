"""Structured JSON logging.

A redaction processor runs on every event, so a credential cannot reach the
log even if a caller passes one by mistake. This is belt-and-braces: callers
are expected not to log secrets, but "expected not to" is not a control.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

import structlog

# Keys whose values are always replaced.
_SENSITIVE_KEYS: frozenset[str] = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "api_key",
        "apikey",
        "llm_api_key",
        "encryption_key",
        "jwt_secret",
        "authorization",
        "connection_string",
        "dsn",
        "encrypted_password",
        "credentials",
    }
)

# Values that look like a DSN with an inline password, wherever they appear.
_DSN_PASSWORD = re.compile(r"(?P<scheme>\w+://[^:/\s]+):([^@\s]+)@")
_BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+")


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        value = _DSN_PASSWORD.sub(r"\g<scheme>:***@", value)
        value = _BEARER.sub("Bearer ***", value)
    return value


def redact_processor(_logger: Any, _method: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    for key in list(event_dict.keys()):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = "[redacted]"
        else:
            event_dict[key] = _redact_value(event_dict[key])
    return event_dict


def configure_logging(*, level: str = "INFO", json_output: bool = True) -> None:
    logging.basicConfig(
        format="%(message)s", stream=sys.stdout, level=getattr(logging, level.upper(), 20)
    )

    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        redact_processor,
    ]
    processors.append(
        structlog.processors.JSONRenderer()
        if json_output
        else structlog.dev.ConsoleRenderer(colors=True)
    )

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), 20)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Quieten access logs -- our middleware emits a richer, structured line.
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.access").propagate = False
