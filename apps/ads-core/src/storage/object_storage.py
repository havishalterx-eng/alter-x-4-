"""ObjectStorageProvider (KNOW-6): presigned uploads for large files.

Adapter-law shape even though this Python service has no access to the TS
`packages/adapters` package: a Protocol interface, a real implementation
behind it, and a mock implementation used by default everywhere until real
AWS credentials exist. No caller in this service ever imports boto3
directly -- only this module does.

Real implementation targets S3-compatible endpoints (real AWS S3 or
LocalStack) via a configurable `endpoint_url` -- never assume real AWS
credentials are present. The FastAPI app wires the mock by default; the
real provider only activates when `ads_object_storage_endpoint_url` (or a
real AWS endpoint) and a bucket name are both explicitly configured.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class ObjectNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class PresignedPost:
    url: str
    fields: dict[str, str]
    key: str


@dataclass(frozen=True)
class ObjectHead:
    key: str
    size_bytes: int
    content_type: str


class ObjectStorageProvider(Protocol):
    def create_presigned_post(
        self,
        *,
        key: str,
        content_type: str,
        max_bytes: int,
        expires_in_seconds: int,
    ) -> PresignedPost: ...

    def head_object(self, *, key: str) -> ObjectHead | None: ...

    def get_object_bytes(self, *, key: str, max_bytes: int) -> bytes: ...

    def put_object_bytes(self, *, key: str, content: bytes, content_type: str) -> str: ...

    def delete_object(self, *, key: str) -> None: ...


class InMemoryObjectStorageProvider:
    """Default provider everywhere until real AWS credentials exist.

    Also the LocalStack-free path for unit tests: `create_presigned_post`
    returns a fake URL/fields shape (same field names a real S3 presigned
    POST would use) and callers can simulate "the client uploaded" by
    calling `simulate_upload` directly -- no real HTTP round trip needed.
    """

    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}
        self._content_types: dict[str, str] = {}

    def create_presigned_post(
        self,
        *,
        key: str,
        content_type: str,
        max_bytes: int,
        expires_in_seconds: int,
    ) -> PresignedPost:
        return PresignedPost(
            url="https://mock-object-storage.local/upload",
            fields={
                "key": key,
                "Content-Type": content_type,
                "policy": f"mock-policy:max_bytes={max_bytes}:expires={expires_in_seconds}",
            },
            key=key,
        )

    def head_object(self, *, key: str) -> ObjectHead | None:
        content = self._objects.get(key)
        if content is None:
            return None
        return ObjectHead(
            key=key,
            size_bytes=len(content),
            content_type=self._content_types.get(key, "application/octet-stream"),
        )

    def get_object_bytes(self, *, key: str, max_bytes: int) -> bytes:
        content = self._objects.get(key)
        if content is None:
            raise ObjectNotFoundError(f"No object at key {key!r}")
        if len(content) > max_bytes:
            raise ValueError(f"Object at key {key!r} exceeds {max_bytes}-byte limit")
        return content

    def put_object_bytes(self, *, key: str, content: bytes, content_type: str) -> str:
        self._objects[key] = content
        self._content_types[key] = content_type
        return key

    def delete_object(self, *, key: str) -> None:
        self._objects.pop(key, None)
        self._content_types.pop(key, None)

    def simulate_upload(self, *, key: str, content: bytes, content_type: str) -> None:
        """Test-only helper: pretend a client completed the presigned POST."""
        self._objects[key] = content
        self._content_types[key] = content_type


@dataclass
class S3ObjectStorageProvider:
    """Real implementation. Never imported/instantiated unless real bucket
    + endpoint configuration is explicitly present (see router wiring)."""

    bucket: str
    endpoint_url: str | None = None
    region: str = "ap-south-1"
    _client: object = field(init=False, repr=False, default=None)

    def __post_init__(self) -> None:
        import boto3  # local import: keeps boto3 optional for every caller

        self._client = boto3.client(
            "s3",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        )

    def create_presigned_post(
        self,
        *,
        key: str,
        content_type: str,
        max_bytes: int,
        expires_in_seconds: int,
    ) -> PresignedPost:
        # Presigned POST (not PUT): lets S3 itself enforce max size via the
        # content-length-range condition -- a raw presigned PUT URL has no
        # native size cap, which would silently drop the existing
        # PayloadValidator.max_content_bytes guarantee for this path.
        response = self._client.generate_presigned_post(  # type: ignore[attr-defined]
            Bucket=self.bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},
                ["content-length-range", 1, max_bytes],
            ],
            ExpiresIn=expires_in_seconds,
        )
        return PresignedPost(
            url=response["url"],
            fields=response["fields"],
            key=key,
        )

    def head_object(self, *, key: str) -> ObjectHead | None:
        from botocore.exceptions import ClientError  # local import

        try:
            response = self._client.head_object(  # type: ignore[attr-defined]
                Bucket=self.bucket, Key=self._key(key)
            )
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise
        return ObjectHead(
            key=key,
            size_bytes=int(response["ContentLength"]),
            content_type=response.get("ContentType", "application/octet-stream"),
        )

    def get_object_bytes(self, *, key: str, max_bytes: int) -> bytes:
        head = self.head_object(key=key)
        if head is None:
            raise ObjectNotFoundError(f"No object at key {key!r}")
        if head.size_bytes > max_bytes:
            raise ValueError(f"Object at key {key!r} exceeds {max_bytes}-byte limit")
        response = self._client.get_object(  # type: ignore[attr-defined]
            Bucket=self.bucket, Key=self._key(key)
        )
        return response["Body"].read()  # type: ignore[no-any-return]

    def put_object_bytes(self, *, key: str, content: bytes, content_type: str) -> str:
        self._client.put_object(  # type: ignore[attr-defined]
            Bucket=self.bucket,
            Key=self._key(key),
            Body=content,
            ContentType=content_type,
        )
        return f"s3://{self.bucket}/{self._key(key)}"

    def delete_object(self, *, key: str) -> None:
        self._client.delete_object(  # type: ignore[attr-defined]
            Bucket=self.bucket, Key=self._key(key)
        )

    def _key(self, key_or_reference: str) -> str:
        prefix = f"s3://{self.bucket}/"
        if key_or_reference.startswith("s3://") and not key_or_reference.startswith(prefix):
            raise ValueError("Object reference belongs to a different bucket")
        return key_or_reference.removeprefix(prefix)
