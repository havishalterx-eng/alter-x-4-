"""Real gRPC client to orchestration-service's ConversationService (HARD-7e).

Target is apps/orchestration-service/src/eval_intent_grpc_server.ts, a
real, disclosed eval-only entrypoint -- not orchestration-service's
production main.ts (see that file's own module doc). The classification
this calls is real; it depends on a real, live model-gateway (HARD-7d's
eval_bootstrap.ts) with a real ANTHROPIC_API_KEY/OPENAI_API_KEY.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from alter.conversation.v1 import conversation_pb2, conversation_pb2_grpc

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class ClassifyIntentResult:
    intent: str
    confidence: float
    actionable: bool


class IntentClient:
    def __init__(self, target: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = conversation_pb2_grpc.ConversationServiceStub(  # type: ignore[no-untyped-call]
            self._channel
        )
        self._timeout_seconds = timeout_seconds

    def classify_intent(
        self, *, tenant_id: str, workspace_id: str, conversation_id: str, utterance: str
    ) -> ClassifyIntentResult:
        response = self._stub.ClassifyIntent(
            conversation_pb2.ClassifyIntentRequest(
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                conversation_id=conversation_id,
                utterance=utterance,
            ),
            timeout=self._timeout_seconds,
        )
        return ClassifyIntentResult(
            intent=response.intent,
            confidence=response.confidence,
            actionable=response.actionable,
        )

    def close(self) -> None:
        self._channel.close()
