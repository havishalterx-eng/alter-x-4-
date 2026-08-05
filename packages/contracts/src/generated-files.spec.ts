import { describe, expect, it } from "vitest";

import { GeneratedFilesOutputSchema } from "./generated-files";

describe("GeneratedFilesOutputSchema", () => {
  it("accepts non-empty content and safe relative paths", () => {
    expect(GeneratedFilesOutputSchema.parse({
      files: [
        { path: "src/index.ts", content: "export {};" },
        { path: "README.md", content: "" },
      ],
    })).toEqual({
      files: [
        { path: "src/index.ts", content: "export {};" },
        { path: "README.md", content: "" },
      ],
    });
  });

  it.each(["/etc/passwd", "../secret", "src/../secret", "src\\index.ts", " src/index.ts"]) (
    "rejects unsafe path %s",
    (path) => {
      expect(GeneratedFilesOutputSchema.safeParse({
        files: [{ path, content: "x" }],
      }).success).toBe(false);
    },
  );

  it("rejects duplicate paths and unrecognized output fields", () => {
    expect(GeneratedFilesOutputSchema.safeParse({
      files: [{ path: "index.ts", content: "a" }, { path: "index.ts", content: "b" }],
    }).success).toBe(false);
    expect(GeneratedFilesOutputSchema.safeParse({
      files: [{ path: "index.ts", content: "a" }], extra: true,
    }).success).toBe(false);
  });
});
