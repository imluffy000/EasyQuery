"""Sensitive-column detection and masking.

Two independent jobs:

* `classify_column` decides, from schema metadata alone, whether a column is
  likely to hold personal data. This runs at schema-sync time so the decision
  is reviewable by an admin rather than made per-query by a model.
* `mask_rows` redacts values before results are summarised by an LLM or
  written to a log. The model sees shape and cardinality, not identities.

Detection is heuristic and deliberately conservative: it over-flags rather
than under-flags, and an admin can always override per column.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Any


class Sensitivity(StrEnum):
    NONE = "none"
    LOW = "low"
    HIGH = "high"


# Column-name patterns, most specific first.
_HIGH_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(ssn|social_security|national_id|passport|tax_id|aadhaar|pan_number)\b",
        r"\b(card_number|cardnumber|cvv|cvc|iban|routing_number|account_number)\b",
        r"\b(password|passwd|secret|api_key|apikey|access_token|refresh_token|private_key)\b",
        r"\b(date_of_birth|dob|birth_date)\b",
    )
)

_LOW_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(email|email_address|e_mail)\b",
        r"\b(phone|phone_number|mobile|telephone|msisdn)\b",
        r"\b(address|street|address_line|postal_code|zip_code|zipcode)\b",
        r"\b(first_name|last_name|full_name|surname|given_name)\b",
        r"\b(ip_address|ip_addr|device_id|latitude|longitude)\b",
    )
)

_EMAIL_VALUE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


def classify_column(column_name: str, data_type: str = "") -> Sensitivity:
    """Classify a column from its name (and type, where it helps)."""
    name = column_name.lower()
    for pattern in _HIGH_PATTERNS:
        if pattern.search(name):
            return Sensitivity.HIGH
    for pattern in _LOW_PATTERNS:
        if pattern.search(name):
            return Sensitivity.LOW
    return Sensitivity.NONE


def mask_value(value: Any, sensitivity: Sensitivity) -> Any:
    """Redact a single value according to its classification."""
    if value is None or sensitivity is Sensitivity.NONE:
        return value
    if sensitivity is Sensitivity.HIGH:
        return "[redacted]"

    text = str(value)
    # Low sensitivity keeps enough shape to stay useful in an explanation.
    if _EMAIL_VALUE.match(text):
        local, _, domain = text.partition("@")
        head = local[0] if local else ""
        return f"{head}***@{domain}"
    if len(text) <= 4:
        return "*" * len(text)
    return f"{text[:2]}{'*' * (len(text) - 4)}{text[-2:]}"


def mask_rows(
    rows: list[dict[str, Any]],
    sensitivity_by_column: dict[str, Sensitivity],
) -> list[dict[str, Any]]:
    """Apply masking to a result set before it leaves the trust boundary."""
    if not sensitivity_by_column:
        return rows
    masked: list[dict[str, Any]] = []
    for row in rows:
        masked.append(
            {
                key: mask_value(value, sensitivity_by_column.get(key, Sensitivity.NONE))
                for key, value in row.items()
            }
        )
    return masked


def sensitive_columns(
    columns: list[tuple[str, str]],
) -> dict[str, Sensitivity]:
    """Classify a list of (name, data_type) pairs, keeping only flagged ones."""
    result: dict[str, Sensitivity] = {}
    for name, data_type in columns:
        level = classify_column(name, data_type)
        if level is not Sensitivity.NONE:
            result[name] = level
    return result
