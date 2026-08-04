import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createOpenApiDocument, V1_ROUTE_SPECS } from "./openapi";

const artifactPath = resolve(
  process.cwd(),
  "packages/contracts/openapi.json",
);

describe("OpenAPI generation", () => {
  it("generates a valid OpenAPI 3.1.1 document", async () => {
    const document = createOpenApiDocument();
    await SwaggerParser.validate(
      structuredClone(document) as never,
    );

    expect(document.openapi).toBe("3.1.1");
  });

  it("covers every API Spec section 7.1 through 7.10 operation", () => {
    const document = createOpenApiDocument();
    const paths = document.paths ?? {};

    for (const route of V1_ROUTE_SPECS) {
      const operation = paths[
        `/api/v1${route.path}`
      ]?.[route.method];

      expect(operation, `${route.method} ${route.path}`).toBeDefined();
    }

    const operationCount = Object.values(paths).reduce(
      (count, pathItem) =>
        count +
        ["get", "post", "patch", "delete"].filter(
          (method) =>
            pathItem?.[method as keyof typeof pathItem] !== undefined,
        ).length,
      0,
    );
    expect(operationCount).toBe(V1_ROUTE_SPECS.length);
    expect(operationCount).toBe(91);
  });

  it("documents both auth headers, problem responses, and idempotency", () => {
    const document = createOpenApiDocument();
    const paths = document.paths ?? {};
    const securitySchemes = document.components?.securitySchemes;

    expect(securitySchemes).toHaveProperty("M2MAuth");
    expect(securitySchemes).toHaveProperty("ActorToken");

    for (const route of V1_ROUTE_SPECS) {
      const operation = paths[
        `/api/v1${route.path}`
      ]?.[route.method];
      if (operation === undefined) {
        throw new Error(`Missing OpenAPI operation: ${route.method} ${route.path}`);
      }

      const defaultResponse = operation.responses?.default;
      expect(defaultResponse).toMatchObject({
        content: {
          "application/problem+json": {
            schema: { $ref: "#/components/schemas/ProblemDetails" },
          },
        },
      });

      if (route.method !== "get") {
        expect(operation.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              in: "header",
              name: "Idempotency-Key",
              required: true,
            }),
          ]),
        );
      }
    }
  });

  it("documents tracing headers on every response and Location on 202 responses", () => {
    const document = createOpenApiDocument();
    const paths = document.paths ?? {};

    for (const route of V1_ROUTE_SPECS) {
      const operation = paths[`/api/v1${route.path}`]?.[route.method];
      if (operation === undefined) {
        throw new Error(`Missing OpenAPI operation: ${route.method} ${route.path}`);
      }

      for (const [status, responseOrReference] of Object.entries(
        operation.responses ?? {},
      )) {
        if ("$ref" in responseOrReference) {
          throw new Error(`Unexpected response reference: ${route.method} ${route.path}`);
        }

        expect(responseOrReference.headers).toEqual(
          expect.objectContaining({
            request_id: expect.any(Object),
            trace_id: expect.any(Object),
          }),
        );

        if (status === "202") {
          expect(responseOrReference.headers).toEqual(
            expect.objectContaining({ Location: expect.any(Object) }),
          );
        }
      }
    }
  });

  it("encodes cursor pagination defaults and maximums", () => {
    const document = createOpenApiDocument();
    const runsOperation = document.paths?.["/api/v1/runs"]?.get;
    const limitParameter = runsOperation?.parameters?.find(
      (parameter) =>
        "name" in parameter && parameter.name === "limit",
    );

    expect(limitParameter).toMatchObject({
      in: "query",
      required: false,
      schema: {
        default: 50,
        maximum: 200,
        minimum: 1,
        type: "integer",
      },
    });
  });

  it("matches the committed generated artifact without drift", async () => {
    const generated = `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;
    const committed = await readFile(artifactPath, "utf8");

    expect(committed.replace(/\r\n/g, "\n")).toBe(generated);
  });
});
