"""Problem Understanding kernel: scoped ADS retrieval plus optional LLM judgment."""

from __future__ import annotations

import json
import logging

from ..ads_client.client import AdsClient
from ..ads_client.models import RetrievalHit, RetrieveRequest
from .llm_client import ProblemUnderstandingLlmClient, ProblemUnderstandingLlmError
from .models import (
    ProblemContextReference,
    ProblemSpec,
    ProblemUnderstandingRequest,
    apply_authoritative_problem_fields,
)

_ADS_TOP_K = 5

_logger = logging.getLogger(__name__)


class ProblemUnderstandingExecutionError(RuntimeError):
    """Problem Understanding could not complete its LLM-backed enrichment."""


class ProblemUnderstandingResponseError(ProblemUnderstandingExecutionError):
    """The Model Gateway answered, and the answer is not a ProblemSpec.

    Distinct from its parent because the two are different events deserving
    different responses: an unreachable gateway is a service that is
    unavailable, while a reply this code cannot read is an upstream that
    answered badly. Reporting the second as the first sends an operator to
    look at the wrong thing, which is what happened until #139 -- both arrived
    as the same 503 carrying the same sentence.
    """


class ProblemUnderstandingKernel:
    """Builds a typed problem from raw input and tenant-scoped ADS context.

    ``llm_client=None`` is deliberate safe degradation for environments without
    LLM credentials. It returns only facts known from request/ADS and records
    missing information rather than fabricating a plausible analysis.
    """

    def __init__(
        self,
        ads_client: AdsClient,
        llm_client: ProblemUnderstandingLlmClient | None = None,
    ) -> None:
        self._ads = ads_client
        self._llm = llm_client

    async def understand(self, request: ProblemUnderstandingRequest) -> ProblemSpec:
        retrieval = await self._ads.retrieve(
            RetrieveRequest(
                tenant_id=request.tenant_id,
                workspace_id=request.workspace_id,
                query=request.objective,
                top_k=_ADS_TOP_K,
            )
        )
        references = [_reference(hit) for hit in retrieval.hits]
        kb_context = _hits_to_context(retrieval.hits)

        if self._llm is None:
            return _fallback_spec(request, references)

        try:
            generated = await self._llm.generate_problem_spec(
                tenant_id=request.tenant_id,
                run_id=request.run_id,
                objective=request.objective,
                actor_context=request.actor_context,
                kb_context=kb_context,
            )
        except ProblemUnderstandingLlmError as exc:
            # The gateway answered; the answer is not a ProblemSpec. Logged
            # here rather than left to the caller because the HTTP layer only
            # renders the message, so without this the reason existed on the
            # exception chain and nowhere a human would ever see it.
            _logger.warning("problem understanding rejected the model reply: %s", exc)
            raise ProblemUnderstandingResponseError(str(exc)) from exc
        except Exception as exc:
            # Still broad: the LLM client is a Protocol, so its transport
            # failures are whatever the injected implementation raises and
            # cannot be enumerated here. The difference from before is that
            # the cause now survives into the message and the log instead of
            # being replaced by a sentence that fits every failure equally.
            _logger.warning("problem understanding model call failed", exc_info=True)
            raise ProblemUnderstandingExecutionError(
                f"Model Gateway call failed: {type(exc).__name__}: {exc}"
            ) from exc

        # Raw request and ADS provenance are authoritative; an LLM cannot
        # rewrite either while enriching the rest of the typed problem.
        return apply_authoritative_problem_fields(generated, request.objective, references)


def _reference(hit: RetrievalHit) -> ProblemContextReference:
    return ProblemContextReference(
        document_id=hit.document_id,
        chunk_reference=hit.chunk_reference,
        confidence=hit.confidence,
        provenance_json=hit.provenance_json,
    )


def _hits_to_context(hits: list[RetrievalHit]) -> str:
    if not hits:
        return ""
    return json.dumps([hit.model_dump() for hit in hits], separators=(",", ":"))


def _fallback_spec(
    request: ProblemUnderstandingRequest,
    references: list[ProblemContextReference],
) -> ProblemSpec:
    actor_values = list(dict.fromkeys(request.actor_context.values()))
    missing = [
        "Constraints, required data, risk, and success criteria require a verified analysis."
    ]
    current_situation: str | None = None
    if references:
        current_situation = f"Verified ADS context is available from {len(references)} source(s)."
    else:
        missing.insert(0, "No verified ADS context was retrieved for this objective.")
    spec = ProblemSpec(
        objective=request.objective,
        actors=actor_values,
        risk="unknown",
        missing_information=missing,
        success_criteria=[
            "Complete the stated objective and verify the result against supplied criteria."
        ],
        context_references=references,
    )
    if current_situation is not None:
        spec.current_situation = current_situation
    return spec
