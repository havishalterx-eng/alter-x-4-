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
