import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createOpenApiDocument } = require("../dist/openapi.js");

const outputUrl = new URL("../openapi.json", import.meta.url);
await writeFile(
  fileURLToPath(outputUrl),
  `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`,
  "utf8",
);
