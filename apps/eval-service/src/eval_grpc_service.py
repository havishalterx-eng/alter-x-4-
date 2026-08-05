"""gRPC transport for the global Engine evaluation domain.

EvalRun and ReleaseGate are global release-evaluation records. The proto
therefore accepts only a golden-set name and returns the run identifier minted
by EvalRunOrchestrator. ReleaseGate persists an aggregate decision/pass rate,
not individual threshold results, so failed_thresholds is intentionally empty.
"""

from __future__ import annotations

import asyncio
import json
from uuid import UUID

import grpc

from alter.eval.v1 import eval_pb2
from src.execution.orchestrator import (
    EvalRunOrchestrator,
    GoldenSetNotFoundError,
    UnsupportedDomainError,
)
from src.release_gates import ReleaseGateRecorder


class EvalGrpcService:
    def __init__(
        self,
        orchestrator: EvalRunOrchestrator,
        release_gate_recorder: ReleaseGateRecorder,
    ) -> None:
        self._orchestrator = orchestrator
        self._release_gate_recorder = release_gate_recorder

    async def RunEvaluation(
        self,
        request: eval_pb2.RunEvaluationRequest,
        context: grpc.aio.ServicerContext[
            eval_pb2.RunEvaluationRequest, eval_pb2.RunEvaluationResponse
        ],
    ) -> eval_pb2.RunEvaluationResponse:
        if not request.golden_set_name.strip():
            await _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "golden_set_name is required")
        try:
            summary = await asyncio.to_thread(
                self._orchestrator.run,
                request.golden_set_name,
                # EvalRun.trigger is a persisted domain enum. gRPC is a
                # transport, not a new trigger category, so use the existing
                # manual trigger for caller-initiated evaluations.
                "manual",
            )
        except GoldenSetNotFoundError as error:
            await _abort(context, grpc.StatusCode.NOT_FOUND, str(error))
        except UnsupportedDomainError as error:
            await _abort(context, grpc.StatusCode.FAILED_PRECONDITION, str(error))
        except Exception:  # noqa: BLE001 -- gRPC boundary must not leak internals
            await _abort(context, grpc.StatusCode.INTERNAL, "evaluation execution failed")

        return eval_pb2.RunEvaluationResponse(
            evaluation_run_id=str(summary.eval_run_id),
            status="completed",
            results_json=json.dumps(
                {
                    "golden_set_name": summary.golden_set_name,
                    "total_cases": summary.total_cases,
                    "passed": summary.passed,
                    "failed": summary.failed,
                    "pass_rate": summary.pass_rate,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
        )

    async def CheckReleaseGate(
        self,
        request: eval_pb2.CheckReleaseGateRequest,
        context: grpc.aio.ServicerContext[
            eval_pb2.CheckReleaseGateRequest, eval_pb2.CheckReleaseGateResponse
        ],
    ) -> eval_pb2.CheckReleaseGateResponse:
        if not request.release_gate_key.strip():
            await _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "release_gate_key is required")
        try:
            eval_run_id = UUID(request.evaluation_run_id)
        except ValueError:
            await _abort(
                context, grpc.StatusCode.INVALID_ARGUMENT, "evaluation_run_id must be a UUID"
            )

        try:
            record = await asyncio.to_thread(
                self._release_gate_recorder.record,
                subject=request.release_gate_key,
                eval_run_id=eval_run_id,
                decided_by=None,
            )
        except LookupError as error:
            await _abort(context, grpc.StatusCode.NOT_FOUND, str(error))
        except ValueError as error:
            await _abort(context, grpc.StatusCode.FAILED_PRECONDITION, str(error))
        except Exception:  # noqa: BLE001 -- gRPC boundary must not leak internals
            await _abort(context, grpc.StatusCode.INTERNAL, "release gate evaluation failed")

        return eval_pb2.CheckReleaseGateResponse(
            passed=record.decision == "approved",
            # ReleaseGate has no persisted threshold-level evidence.
            failed_thresholds=[],
        )


async def _abort(
    context: grpc.aio.ServicerContext[object, object],
    code: grpc.StatusCode,
    details: str,
) -> None:
    await context.abort(code, details)
    raise AssertionError("context.abort must raise")
