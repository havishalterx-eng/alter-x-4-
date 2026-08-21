import type { ApiError } from "./types"

export const isLiveApi = import.meta.env.VITE_API_MODE === "live"

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
export const baseUrl = configuredBaseUrl && configuredBaseUrl !== "/" ? configuredBaseUrl.replace(/\/$/, "") : ""

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown
  idempotencyKey?: string
  ifMatch?: string
}

export class ApiHttpError extends Error {
  readonly error: ApiError
  readonly status: number

  constructor(error: ApiError, status: number) {
    super(error.message)
    this.name = "ApiHttpError"
    this.error = error
    this.status = status
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json, application/problem+json")

  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(options.body)
  }
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey)
  if (options.ifMatch) headers.set("If-Match", options.ifMatch)

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body,
    credentials: "include",
  })

  if (response.status === 204) return undefined as T

  const payload = await readPayload(response)
  if (!response.ok) {
    throw new ApiHttpError(toApiError(payload, response), response.status)
  }

  return payload as T
}

export const apiGet = <T>(path: string, options?: RequestOptions) =>
  apiRequest<T>(path, { ...options, method: "GET" })

export const apiPost = <T>(path: string, body?: unknown, options?: RequestOptions) =>
  apiRequest<T>(path, { ...options, method: "POST", body })

export const apiPatch = <T>(path: string, body?: unknown, options?: RequestOptions) =>
  apiRequest<T>(path, { ...options, method: "PATCH", body })

export const apiDelete = <T>(path: string, options?: RequestOptions) =>
  apiRequest<T>(path, { ...options, method: "DELETE" })

function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function mutationKey(prefix: string) {
  return idempotencyKey(prefix)
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toApiError(payload: unknown, response: Response): ApiError {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    return {
      code: String(record.error_code ?? record.code ?? record.title ?? `HTTP_${response.status}`),
      message: String(record.detail ?? record.message ?? response.statusText),
      requestId: asOptionalString(record.request_id ?? record.requestId),
      details: payload,
    }
  }

  return {
    code: `HTTP_${response.status}`,
    message: typeof payload === "string" ? payload : response.statusText,
  }
}

function asOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
