"""Real clients for HARD-7f (`injection` golden-set domain).

The domain spans three genuinely different real mechanisms, not one:
- suites "injection"/"jailbreak" -> a real, live LLM call
  (PromptInjectionClassifier, via apps/orchestration-service/src/
  eval_security_http_server.ts, chained to HARD-7d's eval_bootstrap.ts).
- suite "ssrf" -> pure, deterministic IP-blocklist logic (ssrf-guard.ts),
  no LLM, exposed on the same eval-only HTTP server.
- suite "upload" -> ads-core's real, existing production HTTP route
  (POST /ads/ingestion/uploads/presign) -- not eval-only scaffolding,
  the genuine production endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class ClassifyInjectionResult:
    blocked: bool
    confidence: float
    reason: str | None


@dataclass(frozen=True)
class CheckSsrfResult:
    blocked: bool
    reason: str | None


@dataclass(frozen=True)
class CheckUploadResult:
    blocked: bool
    detail: str | None


class SecurityEvalClient(httpx.Client):
    """Real HTTP client to eval_security_http_server.ts."""

    def __init__(self, base_url: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        super().__init__(base_url=base_url, timeout=timeout_seconds)

    def classify_injection(
        self, *, tenant_id: str, run_id: str, node_execution_id: str, text: str
    ) -> ClassifyInjectionResult:
        response = self.post(
            "/classify-injection",
            json={
                "tenant_id": tenant_id,
                "run_id": run_id,
                "node_execution_id": node_execution_id,
                "text": text,
            },
        )
        response.raise_for_status()
        body = response.json()
        return ClassifyInjectionResult(
            blocked=body["blocked"],
            confidence=body.get("confidence", 0.0),
            reason=body.get("reason"),
        )

    def check_ssrf(self, *, url: str) -> CheckSsrfResult:
        response = self.post("/check-ssrf", json={"url": url})
        response.raise_for_status()
        body = response.json()
        return CheckSsrfResult(blocked=body["blocked"], reason=body.get("reason"))


class UploadEvalClient(httpx.Client):
    """Real HTTP client to ads-core's real, existing production
    POST /ads/ingestion/uploads/presign route -- not eval-only scaffolding."""

    def __init__(
        self,
        base_url: str,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        *,
        service_token: str = "",
    ) -> None:
        headers = {"Authorization": f"Bearer {service_token}"} if service_token else None
        super().__init__(base_url=base_url, timeout=timeout_seconds, headers=headers)

    def check_upload(
        self, *, tenant_id: str, source_id: str, content_type: str
    ) -> CheckUploadResult:
        response = self.post(
            "/ads/ingestion/uploads/presign",
            headers={"X-Alter-Tenant-Id": tenant_id},
            json={"source_id": source_id, "content_type": content_type},
        )
        if response.status_code == 422:
            return CheckUploadResult(blocked=True, detail=response.json().get("detail"))
        response.raise_for_status()
        return CheckUploadResult(blocked=False, detail=None)
