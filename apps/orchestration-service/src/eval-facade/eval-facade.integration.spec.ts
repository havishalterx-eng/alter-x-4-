import { createHash } from "node:crypto";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { EvalServiceClient } from "@alterx/adapters";

import { EvalFacadeController, EVAL_FACADE_TOKEN_HASH } from "./eval-facade.controller";
import { EvalFacadeExceptionFilter } from "./exception.filter";
import { EvalFacadeService } from "./eval-facade.service";

const TOKEN = "eval-internal-token";

describe("EvalFacadeController HTTP relay", () => {
  it("relays both real routes with current fields and rejects unauthorized requests", async () => {
    const client = {
      runEvaluation: vi.fn().mockResolvedValue({
        evaluation_run_id: "evr_1", status: "completed", results_json: "{}",
      }),
      checkReleaseGate: vi.fn().mockResolvedValue({ passed: true, failed_thresholds: [] }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [EvalFacadeController],
      providers: [
        EvalFacadeService,
        EvalFacadeExceptionFilter,
        { provide: EvalServiceClient, useValue: client },
        {
          provide: EVAL_FACADE_TOKEN_HASH,
          useValue: createHash("sha256").update(TOKEN).digest("hex"),
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    try {
      const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
      const run = await app.getHttpAdapter().getInstance().inject({
        method: "POST", url: "/internal/eval/run-evaluation", headers,
        payload: JSON.stringify({ golden_set_name: "planner" }),
      });
      expect(run.statusCode).toBe(200);
      expect(run.json()).toMatchObject({ evaluation_run_id: "evr_1", status: "completed" });

      const gate = await app.getHttpAdapter().getInstance().inject({
        method: "POST", url: "/internal/eval/check-release-gate", headers,
        payload: JSON.stringify({ release_gate_key: "engine", evaluation_run_id: "evr_1" }),
      });
      expect(gate.statusCode).toBe(200);
      expect(gate.json()).toEqual({ passed: true, failed_thresholds: [] });
      expect(client.runEvaluation).toHaveBeenCalledWith({ golden_set_name: "planner" });
      expect(client.checkReleaseGate).toHaveBeenCalledWith({ release_gate_key: "engine", evaluation_run_id: "evr_1" });

      const rejected = await app.getHttpAdapter().getInstance().inject({
        method: "POST", url: "/internal/eval/run-evaluation", headers: { "content-type": "application/json" },
        payload: JSON.stringify({ golden_set_name: "planner" }),
      });
      expect(rejected.statusCode).toBe(401);
      expect(rejected.headers["content-type"]).toContain("application/problem+json");
      expect(rejected.json()).toMatchObject({ error_code: "EVAL_FACADE_AUTHENTICATION_FAILED" });
      expect(client.runEvaluation).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
