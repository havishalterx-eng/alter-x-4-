"""LLM client contract and stub for the ADVANCED-tier reviewer.

The Verification & Quality Gate calls the Model Gateway
(alter.modelgw.v1.ModelgwService) for its reviewer scoring. The real gRPC
client lives in packages/adapters (vendor-SDK rule); this module defines
only the Protocol the verification kernel depends on and a
contract-complete stub that returns deterministic responses -- same
pattern as apps/intelligence-service/src/planner/llm_client.py.

Wire the stub during development. Swap in the real adapter at integration
time without touching kernel.py.
"""

from typing import Protocol, runtime_checkable

# Alter LLM alias vocabulary (doc 13 sec 2) -- components never name a
# model, only an alias; Model Gateway resolves the actual provider/model
# via policy. Doc 03 sec 4.1 assigns Verification & Quality Gate's reviewer
# to ADVANCED tier.
MODEL_ALIAS_ADVANCED = "ADVANCED"


@runtime_checkable
class ReviewerLlmClient(Protocol):
    """Narrow interface the verification kernel requires from the Model Gateway."""

    async def review(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_type: str,
        rubric: str,
        config_json: str,
        output_json: str,
    ) -> tuple[float, str]:
        """Score a node's output against its rubric.

        Returns (score in [0.0, 1.0], rationale).
        """
        ...


class StubReviewerLlmClient:
    """Contract-complete stub. Scores deterministically from output shape.

    Used during development before the real Model Gateway adapter is
    wired. Never calls any external service. Non-empty, JSON-object output
    scores high (0.9); empty/blank output scores low (0.1) -- just enough
    signal to prove the kernel's banding/dispatch logic end-to-end without
    a real LLM call.
    """

    async def review(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_type: str,
        rubric: str,
        config_json: str,
        output_json: str,
    ) -> tuple[float, str]:
        stripped = output_json.strip()
        if stripped in ("", "{}", "null"):
            return 0.1, "Stub reviewer: output is empty or contains no content."
        return 0.9, "Stub reviewer: output is present and non-empty."
