"""Structural embedding dependency for PLAN-7.

No concrete implementation belongs here.  Python-to-EmbeddingProvider transport
does not exist yet; a future contract ticket must provide it through the Model
Gateway or a dedicated vendor-neutral embedding RPC.
"""

from collections.abc import Sequence
from typing import Protocol, runtime_checkable


@runtime_checkable
class EmbeddingClient(Protocol):
    async def embed(self, *, tenant_id: str, text: str) -> Sequence[float]:
        """Return one 512-dimensional capability-query vector."""
        ...


class EmbeddingTransportUnavailableError(RuntimeError):
    """Raised by NotImplementedEmbeddingClient -- see its docstring."""


class NotImplementedEmbeddingClient:
    """Honest default for the HTTP router (HEAL-6 PR B).

    The capability-similarity ranked-match path in SelectionBindingEngine.bind
    needs a real embedding vector and has never had one to call -- this
    class exists so that path fails closed with a clear, specific error
    instead of the route silently having no default embedding_client at
    all. The `preferred_agent_id` path (SelectionBindingEngine._bind_preferred)
    never calls this and works today. Swap this for a real implementation
    once Python-to-EmbeddingProvider transport exists (disclosed gap, not
    invented here).
    """

    async def embed(self, *, tenant_id: str, text: str) -> Sequence[float]:
        raise EmbeddingTransportUnavailableError(
            "Python-to-EmbeddingProvider transport does not exist yet -- "
            "only preferred_agent_id-based binding is available until it does"
        )
