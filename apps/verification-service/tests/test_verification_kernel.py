"""Unit tests for VerificationKernel.score_node.

Covers: deterministic node types (structural completeness), content-bearing
node types (stub reviewer scoring + banding), and rubric/error handling.
"""

import json

import pytest

from src.verification.kernel import (
    DETERMINISTIC_NODE_TYPES,
    NODE_TYPE_RUBRICS,
    REVIEWER_MODEL_DETERMINISTIC,
    VerificationKernel,
    VerificationValidationError,
)
from src.verification.llm_client import MODEL_ALIAS_ADVANCED, StubReviewerLlmClient
from src.verification.models import NodeType, ScoreNodeRequest

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


def request(
    node_type: NodeType,
    output_json: str = '{"result": "ok"}',
    config_json: str = "{}",
) -> ScoreNodeRequest:
    return ScoreNodeRequest(
        tenant_id=TENANT_ID,
        run_id=RUN_ID,
        node_execution_id=NODE_EXECUTION_ID,
        node_key="node_a",
        node_type=node_type,
        config_json=config_json,
        output_json=output_json,
    )


@pytest.fixture
def kernel() -> VerificationKernel:
    return VerificationKernel(llm_client=StubReviewerLlmClient())


class TestDeterministicNodeTypes:
    @pytest.mark.parametrize("node_type", sorted(DETERMINISTIC_NODE_TYPES))
    async def test_passes_on_non_empty_output(
        self, kernel: VerificationKernel, node_type: NodeType
    ) -> None:
        result = await kernel.score_node(request(node_type, output_json='{"routed": true}'))

        assert result.verdict == "pass"
        assert result.score == 1.0
        assert result.threshold == 1.0
        assert result.reviewer_model == REVIEWER_MODEL_DETERMINISTIC

    @pytest.mark.parametrize("node_type", sorted(DETERMINISTIC_NODE_TYPES))
    async def test_fails_on_empty_output(
        self, kernel: VerificationKernel, node_type: NodeType
    ) -> None:
        result = await kernel.score_node(request(node_type, output_json="{}"))

        assert result.verdict == "fail"
        assert result.score == 0.0

    async def test_fails_on_malformed_json(self, kernel: VerificationKernel) -> None:
        result = await kernel.score_node(request("Gate", output_json="{not json"))

        assert result.verdict == "fail"
        assert result.score == 0.0

    async def test_fails_on_null_output(self, kernel: VerificationKernel) -> None:
        result = await kernel.score_node(request("Gate", output_json="null"))

        assert result.verdict == "fail"

    async def test_deterministic_types_never_call_the_reviewer(self) -> None:
        class ExplodingReviewer:
            async def review(self, **kwargs: object) -> tuple[float, str]:
                raise AssertionError("deterministic node types must not call the reviewer")

        kernel = VerificationKernel(llm_client=ExplodingReviewer())
        result = await kernel.score_node(request("Merge", output_json='{"merged": true}'))

        assert result.verdict == "pass"


class TestContentBearingNodeTypes:
    @pytest.mark.parametrize("node_type", sorted(NODE_TYPE_RUBRICS.keys()))
    async def test_passes_on_non_empty_output(
        self, kernel: VerificationKernel, node_type: NodeType
    ) -> None:
        result = await kernel.score_node(
            request(node_type, output_json='{"content": "a real, substantive answer"}')
        )

        assert result.verdict == "pass"
        assert result.score == 0.9
        assert result.threshold == 0.7
        assert result.reviewer_model == MODEL_ALIAS_ADVANCED
        details = json.loads(result.details_json)
        assert details["rubric"] == NODE_TYPE_RUBRICS[node_type]

    @pytest.mark.parametrize("node_type", sorted(NODE_TYPE_RUBRICS.keys()))
    async def test_fails_on_empty_output(
        self, kernel: VerificationKernel, node_type: NodeType
    ) -> None:
        result = await kernel.score_node(request(node_type, output_json="{}"))

        assert result.verdict == "fail"
        assert result.score == 0.1

    async def test_unregistered_node_type_raises(self, kernel: VerificationKernel) -> None:
        # A node type that is neither deterministic nor rubric-registered
        # cannot occur through the real 11-type contract, but the kernel
        # must still fail closed rather than silently pass unscored content.
        with pytest.raises(VerificationValidationError):
            # Construct via model_construct to bypass the Literal type
            # check, simulating a future/unknown node type reaching the
            # kernel (e.g. a contract version skew).
            req = ScoreNodeRequest.model_construct(
                tenant_id=TENANT_ID,
                run_id=RUN_ID,
                node_execution_id=NODE_EXECUTION_ID,
                node_key="node_a",
                node_type="UnknownFutureType",
                config_json="{}",
                output_json='{"x": 1}',
            )
            await kernel.score_node(req)


class TestScoreBanding:
    async def test_warn_band_between_threshold_and_margin(
        self, kernel: VerificationKernel
    ) -> None:
        class FixedScoreReviewer:
            async def review(self, **kwargs: object) -> tuple[float, str]:
                return 0.6, "borderline"

        banded_kernel = VerificationKernel(llm_client=FixedScoreReviewer())
        result = await banded_kernel.score_node(request("LLMTask"))

        assert result.verdict == "warn"

    async def test_fail_band_below_margin(self, kernel: VerificationKernel) -> None:
        class FixedScoreReviewer:
            async def review(self, **kwargs: object) -> tuple[float, str]:
                return 0.4, "poor"

        banded_kernel = VerificationKernel(llm_client=FixedScoreReviewer())
        result = await banded_kernel.score_node(request("LLMTask"))

        assert result.verdict == "fail"

    async def test_out_of_range_score_raises(self, kernel: VerificationKernel) -> None:
        class BadReviewer:
            async def review(self, **kwargs: object) -> tuple[float, str]:
                return 1.5, "broken reviewer"

        bad_kernel = VerificationKernel(llm_client=BadReviewer())
        with pytest.raises(VerificationValidationError):
            await bad_kernel.score_node(request("LLMTask"))
