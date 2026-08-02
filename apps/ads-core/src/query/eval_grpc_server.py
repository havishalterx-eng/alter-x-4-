"""Real gRPC server entrypoint for HARD-7c (eval-service golden-set
execution only) -- not apps/ads-core's production entrypoint (see
grpc_server.py for that).

Real hybrid retrieval (real Postgres+pgvector, real ts_rank_cd/
websearch_to_tsquery keyword half via SqlAlchemyRetrievalRepository) end to
end, over a real seeded corpus -- but the embedding half uses
FeatureHashingEmbeddings, a real, disclosed, deterministic technique (see
tests/test_retrieval_golden_set.py's own module doc), not the live
Bedrock-backed GrpcEmbeddingClient this service's production serve() uses,
because no live embedding provider is reachable from this environment.

The seeded corpus is the exact same real 12-document launch-floor fixture
(8 real documents + 4 real distractors) tests/test_retrieval_golden_set.py
already hand-authors and discloses -- eval-service's retrieval golden set
(src/db/launch_golden_sets.py's RETRIEVAL_CASES) was itself authored against
these same document keys, so this is the real, matching corpus, not an
approximation. Documents are inserted with their literal doc_* string as
`documents.id` (bypassing the real IngestionPipeline, which mints its own
random doc_ ids) -- same deliberate shortcut the golden-set test already
takes, for the same reason: the golden set's expected_document_key values
need stable, named ids to assert against.

HARD-7g also seeds a second, distinct tenant's ("tenant-b") own scope and
one uniquely-worded document, gated behind optional EVAL_ADS_TENANT_B_*
env vars -- for the tenant-isolation golden set's ads_retrieve case: a
real query for tenant-b's exact wording, issued under tenant-a's own
valid scope, must return zero hits. That's real Postgres RLS
(`app.current_tenant_id`), not an application-level filter -- tenant-b's
chunks are invisible to a tenant-a-scoped session regardless of query
content.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
from concurrent import futures

import grpc
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from alter.adsq.v1 import adsq_pb2_grpc
from src.db.ids import new_prefixed_id
from src.ingestion.embedding_client import EmbeddingDimensions, EmbeddingResult

from .grpc_service import AdsqGrpcService
from .repository import SqlAlchemyRetrievalRepository
from .service import RetrievalService

SERVICE_ROOT_ENV = "ADS_CORE_SERVICE_ROOT"

# Same real 12-document corpus as tests/test_retrieval_golden_set.py,
# duplicated here rather than imported -- that module is test-only code,
# not importable production src.
_CORPUS: tuple[tuple[str, str], ...] = (
    (
        "doc_refund",
        "customers can request a refund within thirty days of purchase for unused items",
    ),
    (
        "doc_password",
        "users can reset their password by clicking the forgot password link on the login page",
    ),
    (
        "doc_shipping",
        "standard shipping takes five to seven business days depending on destination",
    ),
    (
        "doc_warranty",
        "products are covered under warranty for twelve months against manufacturing defects",
    ),
    (
        "doc_cancellation",
        "customers may cancel their subscription anytime from the account settings page",
    ),
    (
        "doc_privacy",
        "we collect only the minimum data required and never sell "
        "customer information to third parties",
    ),
    (
        "doc_payment",
        "we accept credit cards debit cards and bank transfers for all purchases",
    ),
    (
        "doc_support",
        "reach our customer support team via email chat or phone during business hours",
    ),
    (
        "doc_distractor_returns",
        "damaged items may be returned for store credit within seven days",
    ),
    ("doc_distractor_login", "enterprise accounts use single sign-on instead of a password"),
    (
        "doc_distractor_delivery",
        "expedited delivery is available for an additional fee at checkout",
    ),
    (
        "doc_distractor_billing",
        "invoices are billed monthly and payment is due within thirty days",
    ),
)


class FeatureHashingEmbeddings:
    """Real (if simple) text embedding via feature hashing -- see
    tests/test_retrieval_golden_set.py's own copy of this class for the
    full disclosure. Duplicated here for the same reason _CORPUS is."""

    def embed(
        self, *, tenant_id: str, text: str, dimensions: EmbeddingDimensions
    ) -> EmbeddingResult:
        del tenant_id
        vector = [0.0] * dimensions
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            digest = int(hashlib.sha256(word.encode("utf-8")).hexdigest(), 16)
            index = digest % dimensions
            sign = 1.0 if (digest // dimensions) % 2 == 0 else -1.0
            vector[index] += sign
        norm = math.sqrt(sum(component * component for component in vector)) or 1.0
        return EmbeddingResult(
            vector=tuple(component / norm for component in vector),
            model_id="feature-hashing-test-v1",
        )


def _seed_corpus(
    engine: sa.Engine, *, tenant_id: str, workspace_id: str, scope_id: str, source_id: str
) -> None:
    with engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": tenant_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO scopes(id,tenant_id,workspace_id) VALUES (:id,:tenant,:workspace) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": scope_id, "tenant": tenant_id, "workspace": workspace_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO sources(id,tenant_id,scope_id,kind) "
                "VALUES (:id,:tenant,:scope,'upload') ON CONFLICT (id) DO NOTHING"
            ),
            {"id": source_id, "tenant": tenant_id, "scope": scope_id},
        )
        for document_id, text_value in _CORPUS:
            connection.execute(
                sa.text(
                    "INSERT INTO documents"
                    "(id,tenant_id,scope_id,source_id,kind,current_version,status) "
                    "VALUES (:id,:tenant,:scope,:source,'file',1,'active') "
                    "ON CONFLICT (id) DO NOTHING"
                ),
                {"id": document_id, "tenant": tenant_id, "scope": scope_id, "source": source_id},
            )
            connection.execute(
                sa.text(
                    "INSERT INTO document_versions(document_id,version,content_ref,provenance) "
                    "VALUES (:id,1,'ref','{}'::jsonb) ON CONFLICT DO NOTHING"
                ),
                {"id": document_id},
            )
            embedding = FeatureHashingEmbeddings().embed(
                tenant_id=tenant_id, text=text_value, dimensions=1024
            )
            connection.execute(
                sa.text(
                    "INSERT INTO chunks(id,tenant_id,scope_id,document_id,document_version,seq,"
                    "text_content,embedding,embedding_provider,embedding_model,embedding_version) "
                    "VALUES (:id,:tenant,:scope,:document,1,0,:text,CAST(:embedding AS vector),"
                    "'test','feature-hashing-test-v1','v1') ON CONFLICT DO NOTHING"
                ),
                {
                    "id": new_prefixed_id("chk"),
                    "tenant": tenant_id,
                    "scope": scope_id,
                    "document": document_id,
                    "text": text_value,
                    "embedding": "[" + ",".join(str(v) for v in embedding.vector) + "]",
                },
            )


_TENANT_B_UNIQUE_DOCUMENT = (
    "doc_tenant_b_isolation_probe",
    "zynqvortal proprietary rollout schedule for tenant b only",
)


def _seed_tenant_b_probe(
    engine: sa.Engine, *, tenant_id: str, workspace_id: str, scope_id: str, source_id: str
) -> None:
    with engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": tenant_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO scopes(id,tenant_id,workspace_id) VALUES (:id,:tenant,:workspace) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": scope_id, "tenant": tenant_id, "workspace": workspace_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO sources(id,tenant_id,scope_id,kind) "
                "VALUES (:id,:tenant,:scope,'upload') ON CONFLICT (id) DO NOTHING"
            ),
            {"id": source_id, "tenant": tenant_id, "scope": scope_id},
        )
        document_id, text_value = _TENANT_B_UNIQUE_DOCUMENT
        connection.execute(
            sa.text(
                "INSERT INTO documents"
                "(id,tenant_id,scope_id,source_id,kind,current_version,status) "
                "VALUES (:id,:tenant,:scope,:source,'file',1,'active') "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": document_id, "tenant": tenant_id, "scope": scope_id, "source": source_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO document_versions(document_id,version,content_ref,provenance) "
                "VALUES (:id,1,'ref','{}'::jsonb) ON CONFLICT DO NOTHING"
            ),
            {"id": document_id},
        )
        embedding = FeatureHashingEmbeddings().embed(
            tenant_id=tenant_id, text=text_value, dimensions=1024
        )
        connection.execute(
            sa.text(
                "INSERT INTO chunks(id,tenant_id,scope_id,document_id,document_version,seq,"
                "text_content,embedding,embedding_provider,embedding_model,embedding_version) "
                "VALUES (:id,:tenant,:scope,:document,1,0,:text,CAST(:embedding AS vector),"
                "'test','feature-hashing-test-v1','v1') ON CONFLICT DO NOTHING"
            ),
            {
                "id": new_prefixed_id("chk"),
                "tenant": tenant_id,
                "scope": scope_id,
                "document": document_id,
                "text": text_value,
                "embedding": "[" + ",".join(str(v) for v in embedding.vector) + "]",
            },
        )


def serve() -> None:
    db_url = os.environ["EVAL_ADS_DB_URL"]
    service_root = os.environ[SERVICE_ROOT_ENV]
    tenant_id = os.environ["EVAL_ADS_TENANT_ID"]
    workspace_id = os.environ["EVAL_ADS_WORKSPACE_ID"]
    scope_id = os.environ["EVAL_ADS_SCOPE_ID"]

    config = AlembicConfig(f"{service_root}/alembic.ini")
    config.set_main_option("script_location", f"{service_root}/alembic")
    config.set_main_option("sqlalchemy.url", db_url)
    command.upgrade(config, "head")

    engine = sa.create_engine(db_url)
    _seed_corpus(
        engine,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        scope_id=scope_id,
        source_id=new_prefixed_id("src"),
    )

    tenant_b_id = os.environ.get("EVAL_ADS_TENANT_B_ID")
    if tenant_b_id:
        _seed_tenant_b_probe(
            engine,
            tenant_id=tenant_b_id,
            workspace_id=os.environ["EVAL_ADS_TENANT_B_WORKSPACE_ID"],
            scope_id=os.environ["EVAL_ADS_TENANT_B_SCOPE_ID"],
            source_id=new_prefixed_id("src"),
        )

    service = RetrievalService(
        repository=SqlAlchemyRetrievalRepository(
            sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
        ),
        embeddings=FeatureHashingEmbeddings(),
        max_concurrency=4,
    )
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    adsq_pb2_grpc.add_AdsqServiceServicer_to_server(  # type: ignore[no-untyped-call]
        AdsqGrpcService(service), server
    )
    server.add_insecure_port(os.environ["GRPC_BIND_ADDRESS"])
    server.start()
    try:
        server.wait_for_termination()
    finally:
        server.stop(grace=5)
        engine.dispose()


if __name__ == "__main__":
    serve()
