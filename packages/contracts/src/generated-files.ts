import { z } from "./zod";

function isSafeRelativePath(path: string): boolean {
  return (
    path === path.trim() &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

/** Project build `generate_code` output. Paths are sandbox-relative only. */
export const GeneratedFileSchema = z
  .object({
    path: z.string().min(1).refine(isSafeRelativePath, {
      message: "path must be a safe, non-empty relative path",
    }),
    content: z.string(),
  })
  .strict();

export const GeneratedFilesOutputSchema = z
  .object({ files: z.array(GeneratedFileSchema).min(1) })
  .strict()
  .superRefine((value, context) => {
    const paths = new Set<string>();
    for (const [index, file] of value.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "path"],
          message: "file paths must be unique",
        });
      }
      paths.add(file.path);
    }
  });

export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;
export type GeneratedFilesOutput = z.infer<typeof GeneratedFilesOutputSchema>;

/** Included in the real Model Gateway prompt for `node_generate_code`. */
export const GENERATED_FILES_OUTPUT_INSTRUCTION =
  "Return only JSON matching { files: [{ path: string, content: string }] }. " +
  "Each path must be a unique, safe relative file path; do not use absolute paths or '..'.";
