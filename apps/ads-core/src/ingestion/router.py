from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, status
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool

from src.config import Settings, get_settings
from src.db.ids import validate_prefixed_id
from src.storage.object_storage import (
    InMemoryObjectStorageProvider,
    ObjectNotFoundError,
    ObjectStorageProvider,
    S3ObjectStorageProvider,
)

from .chunking import ParagraphAwareChunkSplitter
from .embedding_client import GrpcEmbeddingClient
from .models import (
    CompleteUploadRequest,
    IngestionJobResponse,
    IngestionPayload,
    PresignUploadRequest,
    PresignUploadResponse,
)
from .normalization import TextAwareNormalizer
from .pipeline import IngestionPipeline
from .repository import (
    IngestionJobNotFoundError,
    SourceNotFoundError,
    SqlAlchemyIngestionRepository,
)
from .scanner import DisclosedStubScanner
from .validation import PayloadValidator

_default_pipeline: IngestionPipeline | None = None
_default_storage: ObjectStorageProvider | None = None
_default_settings: Settings | None = None
_default_repository: SqlAlchemyIngestionRepository | None = None
_default_embedding_client: GrpcEmbeddingClient | None = None


def _build_object_storage(settings: Settings) -> ObjectStorageProvider:
    # No real bucket configured => no real AWS assumed. This is the only
    # branch point between mock and real; every caller goes through the
    # ObjectStorageProvider Protocol either way.
    if not settings.ads_uploads_bucket_name:
        return InMemoryObjectStorageProvider()
    return S3ObjectStorageProvider(
        bucket=settings.ads_uploads_bucket_name,
        endpoint_url=settings.ads_uploads_s3_endpoint_url,
        region=settings.ads_uploads_s3_region,
    )


@asynccontextmanager
async def ingestion_lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    global _default_pipeline, _default_storage, _default_settings
    global _default_repository, _default_embedding_client
    settings = get_settings()
    _default_settings = settings
    engine = create_engine(settings.ads_db_url_sync, pool_pre_ping=True)
    sessions = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    allowed_content_types = frozenset(
        value.strip().lower()
        for value in settings.ads_ingestion_allowed_mime_types.split(",")
        if value.strip()
    )
    signatures = tuple(
        value.strip().encode("utf-8")
        for value in settings.ads_ingestion_stub_bad_signatures.split(",")
        if value.strip()
    )
    repository = SqlAlchemyIngestionRepository(sessions)
    _default_repository = repository
    _default_embedding_client = GrpcEmbeddingClient(settings.model_gateway_grpc_target)
    _default_pipeline = IngestionPipeline(
        repository=repository,
        validator=PayloadValidator(
            max_content_bytes=settings.ads_ingestion_max_content_bytes,
            allowed_content_types=allowed_content_types,
        ),
        scanner=DisclosedStubScanner(signatures),
        normalizer=TextAwareNormalizer(),
        chunk_splitter=ParagraphAwareChunkSplitter(),
        embedding_client=_default_embedding_client,
    )
    _default_storage = _build_object_storage(settings)
    try:
        yield
    finally:
        _default_pipeline = None
        _default_storage = None
        _default_settings = None
        _default_repository = None
        if _default_embedding_client is not None:
            _default_embedding_client.close()
            _default_embedding_client = None
        engine.dispose()


def get_ingestion_pipeline() -> IngestionPipeline:
    if _default_pipeline is None:
        raise RuntimeError("Ingestion pipeline is not initialized")
    return _default_pipeline


def get_object_storage() -> ObjectStorageProvider:
    if _default_storage is None:
        raise RuntimeError("Object storage provider is not initialized")
    return _default_storage


def get_ingestion_settings() -> Settings:
    if _default_settings is None:
        raise RuntimeError("Settings are not initialized")
    return _default_settings


def get_ingestion_repository() -> SqlAlchemyIngestionRepository:
    if _default_repository is None:
        raise RuntimeError("Ingestion repository is not initialized")
    return _default_repository


PipelineDep = Annotated[IngestionPipeline, Depends(get_ingestion_pipeline)]
StorageDep = Annotated[ObjectStorageProvider, Depends(get_object_storage)]
SettingsDep = Annotated[Settings, Depends(get_ingestion_settings)]
RepositoryDep = Annotated[SqlAlchemyIngestionRepository, Depends(get_ingestion_repository)]

router = APIRouter(prefix="/ads", tags=["ads-ingestion"])


@router.post(
    "/ingestion/uploads",
    response_model=IngestionJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_upload(
    request: Request,
    pipeline: PipelineDep,
    tenant_id: Annotated[str, Header(alias="X-Alter-Tenant-Id")],
    source_id: Annotated[str, Header(alias="X-Alter-Source-Id")],
) -> IngestionJobResponse:
    try:
        return await run_in_threadpool(
            pipeline.ingest,
            IngestionPayload(
                tenant_id=tenant_id,
                source_id=source_id,
                content_type=request.headers.get("content-type", ""),
                content=await request.body(),
            ),
        )
    except SourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@router.post(
    "/ingestion/uploads/presign",
    response_model=PresignUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def presign_upload(
    body: PresignUploadRequest,
    storage: StorageDep,
    settings: SettingsDep,
    tenant_id: Annotated[str, Header(alias="X-Alter-Tenant-Id")],
) -> PresignUploadResponse:
    """KNOW-6 real upload path for large files: client PUTs/POSTs straight
    to object storage, never through this app server's request body (that
    remains KNOW-3's `/ingestion/uploads` -- unchanged, still real, used
    for small/synchronous payloads).

    Size enforcement uses a presigned POST (not PUT) so the
    `content-length-range` policy condition is enforced by the object
    store itself -- a raw presigned PUT URL has no native size cap, which
    would silently drop the same `max_content_bytes` guarantee KNOW-3's
    path already has.
    """
    try:
        validate_prefixed_id("ten", tenant_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    content_type = body.content_type.partition(";")[0].strip().lower()
    allowed_content_types = frozenset(
        value.strip().lower()
        for value in settings.ads_ingestion_allowed_mime_types.split(",")
        if value.strip()
    )
    if content_type not in allowed_content_types:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Declared content type is not in the upload allowlist",
        )

    # Server-generated, tenant-scoped key -- the client never supplies or
    # influences the key, so a presigned POST can never be used to write
    # into another tenant's prefix.
    bare_tenant = tenant_id.removeprefix("ten_")
    upload_key = f"tenants/{bare_tenant}/uploads/{uuid.uuid4().hex}"

    presigned = await run_in_threadpool(
        storage.create_presigned_post,
        key=upload_key,
        content_type=content_type,
        max_bytes=settings.ads_ingestion_max_content_bytes,
        expires_in_seconds=settings.ads_uploads_presign_expiry_seconds,
    )
    return PresignUploadResponse(
        upload_url=presigned.url,
        upload_fields=presigned.fields,
        upload_key=presigned.key,
        max_content_bytes=settings.ads_ingestion_max_content_bytes,
        expires_in_seconds=settings.ads_uploads_presign_expiry_seconds,
    )


@router.post(
    "/ingestion/uploads/complete",
    response_model=IngestionJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def complete_upload(
    body: CompleteUploadRequest,
    pipeline: PipelineDep,
    storage: StorageDep,
    settings: SettingsDep,
    tenant_id: Annotated[str, Header(alias="X-Alter-Tenant-Id")],
) -> IngestionJobResponse:
    """Real, idempotent handler for "the object landed in object storage."

    Interim trigger: called directly (by the client, or by an operator/test)
    rather than by a real S3-event -> SQS consumer, because no real AWS
    event infrastructure exists yet (disclosed gap, follow-up ticket wires
    a real SQS consumer that calls this exact function). This is still
    honest, not spoofable: the object's real existence, size, and type are
    verified via `head_object` against the real store before any ingestion
    job is created -- a caller cannot fake completion by merely calling
    this endpoint, the object must genuinely be present. Orphaned objects
    for uploads that never complete are handled by the bucket's own
    lifecycle expiry (Terraform), not by application logic here.
    """
    try:
        validate_prefixed_id("ten", tenant_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    bare_tenant = tenant_id.removeprefix("ten_")
    if not body.upload_key.startswith(f"tenants/{bare_tenant}/uploads/"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="upload_key does not belong to the requesting tenant",
        )

    head = await run_in_threadpool(storage.head_object, key=body.upload_key)
    if head is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No object exists at upload_key -- upload did not complete",
        )
    if head.size_bytes > settings.ads_ingestion_max_content_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded object exceeds the configured content-byte limit",
        )

    try:
        content = await run_in_threadpool(
            storage.get_object_bytes,
            key=body.upload_key,
            max_bytes=settings.ads_ingestion_max_content_bytes,
        )
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    try:
        response = await run_in_threadpool(
            pipeline.ingest,
            IngestionPayload(
                tenant_id=tenant_id,
                source_id=body.source_id,
                content_type=head.content_type,
                content=content,
            ),
        )
    except SourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # Raw staging copy no longer needed once the pipeline has consumed it --
    # the durable record is now the ingestion job + (eventually) the
    # document/document_version rows, not this transient upload object.
    # Best-effort: a delete failure here must never fail the request, the
    # bucket's lifecycle rule is the backstop.
    try:
        await run_in_threadpool(storage.delete_object, key=body.upload_key)
    except Exception:  # noqa: BLE001 -- best-effort cleanup, never surfaced
        pass

    return response


@router.get(
    "/ingestion/jobs/{ingestion_job_id}",
    response_model=IngestionJobResponse,
)
async def get_ingestion_job(
    ingestion_job_id: str,
    repository: RepositoryDep,
    tenant_id: Annotated[str, Header(alias="X-Alter-Tenant-Id")],
) -> IngestionJobResponse:
    try:
        validate_prefixed_id("ten", tenant_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    bare_tenant = tenant_id.removeprefix("ten_")
    try:
        job = await run_in_threadpool(
            repository.get,
            tenant_uuid=bare_tenant,
            ingestion_job_id=ingestion_job_id,
        )
    except IngestionJobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    error = None
    if job.error is not None:
        from .models import IngestionError

        error = IngestionError.model_validate(job.error)
    return IngestionJobResponse(
        ingestion_job_id=job.ingestion_job_id,
        source_id=job.source_id,
        stage=job.stage,
        stats=job.stats,
        error=error,
        created_at=job.created_at,
        completed_at=job.completed_at,
    )
