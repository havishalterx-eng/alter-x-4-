from __future__ import annotations

from .ids import new_prefixed_uuid7
from .models import ProblemDetails


class VerificationError(Exception):
    def __init__(self, problem: ProblemDetails) -> None:
        super().__init__(problem.detail)
        self.problem = problem


def verification_problem(
    *,
    status: int,
    title: str,
    detail: str,
    error_code: str,
    retryable: bool,
    documentation_key: str,
    instance: str,
) -> ProblemDetails:
    return ProblemDetails(
        type=f"https://docs.alterx.dev/problems/{documentation_key}",
        title=title,
        status=status,
        detail=detail,
        instance=instance,
        error_code=error_code,
        trace_id=new_prefixed_uuid7("trc"),
        request_id=new_prefixed_uuid7("req"),
        retryable=retryable,
        field_errors=(),
        documentation_key=documentation_key,
    )
