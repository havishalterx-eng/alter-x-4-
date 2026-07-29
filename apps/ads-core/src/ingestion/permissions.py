from __future__ import annotations


def default_permissions() -> dict[str, object]:
    """Starting-point permissions for a newly-ingested document.

    No ACL/sharing system exists anywhere in this repo yet -- this is a real,
    honest default (tenant-wide read, no explicit external shares), not a
    full permissions engine. A future ticket that adds real per-document
    sharing controls should replace this, not KNOW-4.
    """
    return {"visibility": "tenant", "shared_with": []}
