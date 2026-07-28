import { parse } from "yaml";

import type { NodeType } from "@alterx/contracts";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * YAMLImport: parses config.yaml into a plain object and returns it as
 * output. No external calls, no code execution -- the `yaml` package
 * parses data only (no custom-tag or unsafe-load surface), so this is
 * safe against untrusted YAML content by construction.
 */
export class YamlImportHandler implements NodeHandler {
  readonly nodeType: NodeType = "YAMLImport";

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const yamlSource = context.config["yaml"];
    if (typeof yamlSource !== "string" || yamlSource.trim().length === 0) {
      throw new NodeHandlerValidationError(
        "YAMLImport requires a non-empty config.yaml string",
      );
    }

    let parsed: unknown;
    try {
      parsed = parse(yamlSource);
    } catch (error: unknown) {
      throw new NodeHandlerValidationError(
        `config.yaml is not valid YAML: ${(error as Error).message}`,
      );
    }

    if (!isPlainObject(parsed)) {
      throw new NodeHandlerValidationError(
        "config.yaml must parse to an object, not a scalar or array",
      );
    }

    return { output: parsed };
  }
}
