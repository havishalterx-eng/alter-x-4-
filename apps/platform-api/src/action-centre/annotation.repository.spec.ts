import { describe, expect, it, vi } from "vitest";
import { AnnotationRepository } from "./annotation.repository";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";

function fakeClient(queryImpl: (sql: string, values?: unknown[]) => unknown) {
  return { query: vi.fn(queryImpl), release: vi.fn() };
}

describe("AnnotationRepository", () => {
  it("appends an annotation in a tenant-scoped transaction", async () => {
    const annotation = {
      id: "ain_018f47a5-7b2c-7d10-8f11-123456789abd",
      item_type: "approval" as const,
      item_id: "apr_018f47a5-7b2c-7d10-8f11-123456789abe",
      note: "Ready for review",
      created_by: "usr_018f47a5-7b2c-7d10-8f11-123456789abf",
      created_at: "2026-08-06T00:00:00.000Z",
    };
    const client = fakeClient((sql) =>
      sql.startsWith("INSERT INTO action_item_annotations") ? { rows: [annotation] } : { rows: [] },
    );
    const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn() };
    const repository = new AnnotationRepository(pool as never);

    await expect(
      repository.create(tenantId, "approval", annotation.item_id, annotation.note, annotation.created_by),
    ).resolves.toEqual(annotation);

    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("set_config"), [tenantId]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO action_item_annotations"),
      [expect.stringMatching(/^ain_/), tenantId, "approval", annotation.item_id, annotation.note, annotation.created_by],
    );
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("lists annotations in creation order and rolls back failures", async () => {
    const client = fakeClient((sql) => {
      if (sql.startsWith("SELECT id,item_type")) {
        return { rows: [{ id: "ain_1", note: "first" }, { id: "ain_2", note: "second" }] };
      }
      return { rows: [] };
    });
    const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn() };
    const repository = new AnnotationRepository(pool as never);

    await expect(repository.list(tenantId, "clarification", "clr_018f47a5-7b2c-7d10-8f11-123456789abe")).resolves.toEqual([
      { id: "ain_1", note: "first" },
      { id: "ain_2", note: "second" },
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY created_at ASC,id ASC"),
      [tenantId, "clarification", "clr_018f47a5-7b2c-7d10-8f11-123456789abe"],
    );

    const broken = fakeClient((sql) => {
      if (sql.startsWith("INSERT INTO action_item_annotations")) throw new Error("write failed");
      return { rows: [] };
    });
    const brokenRepository = new AnnotationRepository(
      { connect: vi.fn().mockResolvedValue(broken), end: vi.fn() } as never,
    );
    await expect(
      brokenRepository.create(tenantId, "escalation", "esc_018f47a5-7b2c-7d10-8f11-123456789abe", "note", "usr_1"),
    ).rejects.toThrow("write failed");
    expect(broken.query).toHaveBeenCalledWith("ROLLBACK");
    expect(broken.release).toHaveBeenCalledTimes(1);
  });
});
