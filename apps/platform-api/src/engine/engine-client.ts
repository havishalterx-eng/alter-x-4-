import { Inject, Injectable } from "@nestjs/common";
import type { EngineConfig } from "./config";
import {
  ENGINE_AUTH_PROVIDER,
  type EngineAuthProvider,
} from "./auth";
import {
  EngineProblemError,
  engineProblemFromResponse,
  upstreamProblem,
} from "./problem";
import type {
  EngineCallerContext,
  EngineMutationOptions,
  EnginePatchOptions,
  EnginePath,
  EngineRequestBody,
  EngineResponse,
} from "./types";

export const ENGINE_CONFIG = Symbol("ENGINE_CONFIG");

type EngineMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  body?: EngineRequestBody;
  idempotencyKey?: string;
  ifMatch?: string;
}

@Injectable()
export class EngineClient {
  constructor(
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    @Inject(ENGINE_AUTH_PROVIDER)
    private readonly authProvider: EngineAuthProvider,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retryDelay: (milliseconds: number) => Promise<void> = delay,
  ) {}

  get<TResponse>(
    path: EnginePath,
    context: EngineCallerContext,
  ): Promise<EngineResponse<TResponse>> {
    return this.request("GET", path, context);
  }

  post<TRequest extends EngineRequestBody, TResponse>(
    path: EnginePath,
    body: TRequest,
    context: EngineCallerContext,
    options: EngineMutationOptions,
  ): Promise<EngineResponse<TResponse>> {
    return this.request("POST", path, context, {
      body,
      idempotencyKey: options.idempotencyKey,
    });
  }

  patch<TRequest extends EngineRequestBody, TResponse>(
    path: EnginePath,
    body: TRequest,
    context: EngineCallerContext,
    options: EnginePatchOptions,
  ): Promise<EngineResponse<TResponse>> {
    return this.request("PATCH", path, context, {
      body,
      idempotencyKey: options.idempotencyKey,
      ifMatch: options.ifMatch,
    });
  }

  delete<TResponse>(
    path: EnginePath,
    context: EngineCallerContext,
    options: EngineMutationOptions,
  ): Promise<EngineResponse<TResponse>> {
    return this.request("DELETE", path, context, {
      idempotencyKey: options.idempotencyKey,
    });
  }

  private async request<TResponse>(
    method: EngineMethod,
    path: EnginePath,
    context: EngineCallerContext,
    options: RequestOptions = {},
  ): Promise<EngineResponse<TResponse>> {
    assertEnginePath(path);
    let authorization;
    try {
      authorization = await this.authProvider.authorize(context);
    } catch {
      throw new EngineProblemError(
        upstreamProblem(502, path, "UPSTREAM_SERVICE_ERROR"),
      );
    }
    const attempts = method === "GET" ? 2 : 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.config.baseUrl}${path}`,
          {
            method,
            headers: requestHeaders(context, authorization, options),
            ...(options.body === undefined
              ? {}
              : { body: JSON.stringify(options.body) }),
          },
        );

        if (response.ok) {
          return responseBody<TResponse>(response);
        }

        if (
          method === "GET" &&
          attempt === 0 &&
          isRetryableStatus(response.status)
        ) {
          await this.retryDelay(25);
          continue;
        }

        throw new EngineProblemError(
          await engineProblemFromResponse(response, path),
        );
      } catch (error) {
        if (error instanceof EngineProblemError) {
          throw error;
        }

        if (method === "GET" && attempt === 0) {
          await this.retryDelay(25);
          continue;
        }

        const timeout = isAbortError(error);
        throw new EngineProblemError(
          upstreamProblem(
            timeout ? 504 : 502,
            path,
            timeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_SERVICE_ERROR",
          ),
        );
      }
    }

    throw new Error("Engine request exhausted without result");
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function requestHeaders(
  context: EngineCallerContext,
  authorization: { m2mAccessToken: string; actorToken: string },
  options: RequestOptions,
): Record<string, string> {
  return {
    Authorization: `Bearer ${authorization.m2mAccessToken}`,
    "X-Alter-Actor-Token": authorization.actorToken,
    traceparent: context.traceparent,
    Accept: "application/json, application/problem+json",
    ...(options.body === undefined
      ? {}
      : { "content-type": "application/json" }),
    ...(options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : {}),
    ...(options.ifMatch ? { "If-Match": options.ifMatch } : {}),
  };
}

async function responseBody<TResponse>(
  response: Response,
): Promise<EngineResponse<TResponse>> {
  const text = await response.text();
  const result: EngineResponse<TResponse> = {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as TResponse,
  };
  setIfPresent(result, "etag", response.headers.get("etag"));
  setIfPresent(result, "location", response.headers.get("location"));
  setIfPresent(result, "requestId", response.headers.get("request_id"));
  setIfPresent(result, "traceId", response.headers.get("trace_id"));
  return result;
}

function setIfPresent<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | null,
): void {
  if (value !== null) {
    target[key] = value;
  }
}

function assertEnginePath(path: string): asserts path is EnginePath {
  if (!path.startsWith("/api/v1/") || path.includes("://")) {
    throw new Error("Engine path must stay under /api/v1/");
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
