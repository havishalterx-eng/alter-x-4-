from collections.abc import Iterable

from src.ingestion.models import IngestionJobResponse, IngestionPayload
from src.ingestion.pipeline import IngestionPipeline

from .models import ConnectorDocument, ConnectorSource
from .providers import ConnectorProviderClient, ConnectorSyncError
from .repository import ConnectorSourceRepository


class ConnectorSyncService:
    def __init__(
        self,
        *,
        pipeline: IngestionPipeline,
        sources: ConnectorSourceRepository,
        providers: ConnectorProviderClient,
    ) -> None:
        self._pipeline = pipeline
        self._sources = sources
        self._providers = providers

    def scheduled_sync(
        self, *, tenant_id: str, source_id: str
    ) -> tuple[IngestionJobResponse, ...]:
        source = self._sources.get(tenant_id=tenant_id, source_id=source_id)
        jobs = self._ingest(source, self._providers.pull(source))
        self._sources.mark_synchronized(tenant_id=tenant_id, source_id=source_id)
        return jobs

    def webhook_sync(
        self,
        *,
        tenant_id: str,
        source_id: str,
        provider: str,
        headers: dict[str, str],
        body: bytes,
    ) -> tuple[IngestionJobResponse, ...]:
        source = self._sources.get(tenant_id=tenant_id, source_id=source_id)
        if source.provider != provider:
            raise ConnectorSyncError("Webhook provider does not match source provider")
        self._providers.verify_webhook(source, headers=headers, body=body)
        jobs = self._ingest(source, self._providers.pull(source))
        self._sources.mark_synchronized(tenant_id=tenant_id, source_id=source_id)
        return jobs

    def _ingest(
        self, source: ConnectorSource, documents: Iterable[ConnectorDocument]
    ) -> tuple[IngestionJobResponse, ...]:
        return tuple(
            self._pipeline.ingest(
                IngestionPayload(
                    tenant_id=source.tenant_id,
                    source_id=source.id,
                    content_type=document.content_type,
                    content=document.content,
                )
            )
            for document in documents
        )
