import { randomUUID } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";
import type { ProblemDetails } from "@alterx/contracts";
import { PUBLIC_ROUTE_METADATA } from "./public-route";
import type { SessionGatewayRequest, SessionGatewayResponse } from "./types";

export interface SessionGatewayUploadAllowlistOptions {
  readonly allowedContentTypes?: readonly string[];
  readonly maxContentLengthBytes?: number;
}

const DEFAULT_ALLOWED_CONTENT_TYPES: readonly string[] = [
  "application/json",
  "text/plain",
  "application/pdf",
  "image/png",
  "image/jpeg",
];

const DEFAULT_MAX_CONTENT_LENGTH_BYTES = 25 * 1024 * 1024;

interface UploadRequest extends SessionGatewayRequest {
  readonly headers: SessionGatewayRequest["headers"] & {
    readonly "content-type"?: string;
    readonly "content-length"?: string;
  };
}

/**
 * Blocks any request whose Content-Type is not on the allowlist, or whose
 * declared Content-Length exceeds the configured maximum, before the body is
 * ever parsed further downstream. This is a declared-header check, not a
 * byte-sniffing content-type detector -- a client that lies about its
 * Content-Type header is a known limitation, documented in the ticket's
 * known gaps, not silently claimed as covered here.
 */
@Injectable()
export class SessionGatewayUploadAllowlistGuard implements CanActivate {
  readonly #allowedContentTypes: readonly string[];
  readonly #maxContentLengthBytes: number;

  constructor(options: SessionGatewayUploadAllowlistOptions = {}) {
    this.#allowedContentTypes =
      options.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES;
    this.#maxContentLengthBytes =
      options.maxContentLengthBytes ?? DEFAULT_MAX_CONTENT_LENGTH_BYTES;
  }

  canActivate(context: ExecutionContext): boolean {
    if (
      Reflect.getMetadata(PUBLIC_ROUTE_METADATA, context.getHandler()) ===
        true ||
      Reflect.getMetadata(PUBLIC_ROUTE_METADATA, context.getClass()) === true
    ) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<UploadRequest>();
    const contentType = firstHeader(request.headers["content-type"]);

    if (contentType !== undefined) {
      const baseType = contentType.split(";")[0]?.trim().toLowerCase();
      if (
        baseType === undefined ||
        !this.#allowedContentTypes.includes(baseType)
      ) {
        this.#reject(
          http.getResponse<SessionGatewayResponse>(),
          request.url,
          `Content-Type "${contentType}" is not permitted for uploads.`,
        );
      }
    }

    const contentLengthHeader = firstHeader(request.headers["content-length"]);
    if (contentLengthHeader !== undefined) {
      const contentLength = Number(contentLengthHeader);
      if (
        Number.isFinite(contentLength) &&
        contentLength > this.#maxContentLengthBytes
      ) {
        this.#reject(
          http.getResponse<SessionGatewayResponse>(),
          request.url,
          `Upload of ${contentLength} bytes exceeds the maximum of ${this.#maxContentLengthBytes} bytes.`,
        );
      }
    }

    return true;
  }

  #reject(
    response: SessionGatewayResponse,
    requestUrl: string | undefined,
    detail: string,
  ): never {
    setProblemContentType(response);
    throw new HttpException(uploadProblem(requestUrl, detail), 415);
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function setProblemContentType(response: SessionGatewayResponse): void {
  if (response.header) {
    response.header("content-type", "application/problem+json");
  } else {
    response.setHeader?.("content-type", "application/problem+json");
  }
}

function uploadProblem(requestUrl: string | undefined, detail: string): ProblemDetails {
  const instance = requestUrl?.startsWith("/") ? requestUrl : "/";
  return {
    type: "https://alter.dev/problems/session-gateway-upload-rejected",
    title: "Unsupported Media Type",
    status: 415,
    detail,
    instance,
    error_code: "SESSION_GATEWAY_UPLOAD_REJECTED",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "auth.upload-rejected",
  };
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}
