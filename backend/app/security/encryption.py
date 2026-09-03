"""Envelope encryption for user-database credentials.

Connection passwords are never stored in plaintext and never leave this module
in encrypted form by accident: `SecretBox.decrypt` is the only way back, and
callers are expected to hold the plaintext for the lifetime of a single
connection attempt.

Key rotation is supported by keeping a list of keys. The first key encrypts;
any key may decrypt. To rotate: prepend a new key, re-encrypt at leisure, then
drop the old one.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken, MultiFernet


def derive_fernet_key(secret: str) -> bytes:
    """Derive a urlsafe-base64 32-byte Fernet key from an arbitrary secret.

    Accepts an already-valid Fernet key unchanged so operators can supply one
    generated with `Fernet.generate_key()`.
    """
    raw = secret.encode("utf-8")
    try:
        candidate = base64.urlsafe_b64decode(raw)
        if len(candidate) == 32:
            return raw
    except Exception:  # noqa: BLE001, S110 - not a base64 key; fall through and derive one
        pass
    digest = hashlib.sha256(raw).digest()
    return base64.urlsafe_b64encode(digest)


@dataclass
class SecretBox:
    """Symmetric encryption for credentials at rest."""

    _fernet: MultiFernet

    @classmethod
    def from_keys(cls, keys: list[str]) -> SecretBox:
        if not keys:
            raise ValueError("At least one encryption key is required.")
        return cls(MultiFernet([Fernet(derive_fernet_key(k)) for k in keys]))

    @classmethod
    def from_key(cls, key: str) -> SecretBox:
        return cls.from_keys([key])

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise ValueError(
                "Stored credential could not be decrypted. The encryption key may have "
                "been rotated without re-encrypting existing connections."
            ) from exc

    def rotate(self, token: str) -> str:
        """Re-encrypt an existing token under the current primary key."""
        return self._fernet.rotate(token.encode("ascii")).decode("ascii")


def fingerprint(value: str) -> str:
    """Short non-reversible identifier, safe to log.

    Used to correlate a stored credential across log lines without ever
    writing the credential itself.
    """
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
