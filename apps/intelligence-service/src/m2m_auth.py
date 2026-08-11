"""Auth0 client-credentials metadata for internal gRPC callers."""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from typing import Protocol
from urllib.parse import urlparse

import httpx


class AccessTokenProvider(Protocol):
    def metadata(self) -> tuple[tuple[str, str], ...]: ...


class Auth0M2mTokenProvider:
    def __init__(
        self, *, token_url: str, audience: str, client_id: str, client_secret: str
    ) -> None:
        if not all(value.strip() for value in (token_url, audience, client_id, client_secret)):
            raise ValueError("Auth0 M2M configuration is incomplete")
        _assert_secure_token_url(token_url)
        self._token_url = token_url
        self._audience = audience
        self._client_id = client_id
        self._client_secret = client_secret
        self._cached: tuple[str, float] | None = None

    @classmethod
    def from_settings(cls, settings: object) -> Auth0M2mTokenProvider:
        return cls(
            token_url=str(getattr(settings, "auth0_m2m_token_url")),
            audience=str(getattr(settings, "auth0_m2m_audience")),
            client_id=str(getattr(settings, "auth0_m2m_client_id")),
            client_secret=str(getattr(settings, "auth0_m2m_client_secret")),
        )

    def metadata(self) -> tuple[tuple[str, str], ...]:
        if self._cached is None or self._cached[1] <= time.time() + 60:
            response = httpx.post(
                self._token_url,
                json={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "audience": self._audience,
                },
                timeout=10,
            )
            response.raise_for_status()
            payload: Mapping[str, object] = response.json()
            token, expires_in = payload.get("access_token"), payload.get("expires_in")
            if (
                not isinstance(token, str)
                or not token
                or not isinstance(expires_in, int)
                or expires_in <= 0
            ):
                raise RuntimeError("M2M token response failed validation")
            self._cached = (token, time.time() + expires_in)
        return (("authorization", f"Bearer {self._cached[0]}"),)


def _assert_secure_token_url(token_url: str) -> None:
    parsed = urlparse(token_url)
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1", "localhost"}:
        return
    raise ValueError("Auth0 M2M token URL must use HTTPS outside loopback tests")


class LazyAuth0M2mTokenProvider:
    """Defer M2M config validation until an outbound call needs a token."""

    def __init__(self, factory: Callable[[], Auth0M2mTokenProvider]) -> None:
        self._factory = factory
        self._provider: Auth0M2mTokenProvider | None = None

    def metadata(self) -> tuple[tuple[str, str], ...]:
        if self._provider is None:
            self._provider = self._factory()
        return self._provider.metadata()


def lazy_auth0_m2m_token_provider_from_settings(settings: object) -> LazyAuth0M2mTokenProvider:
    return LazyAuth0M2mTokenProvider(lambda: Auth0M2mTokenProvider.from_settings(settings))
