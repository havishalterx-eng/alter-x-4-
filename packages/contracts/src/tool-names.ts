import { z } from "./zod";

/**
 * The canonical tool set the Tool Gateway offers.
 *
 * Before this existed, `tool_name` was a free string end to end: the proto
 * declares it `string`, the compiler passes it through untouched, the
 * capability resolver's ToolRequirement.name accepts any non-empty string,
 * and tool permission policies are keyed by `"{tenant}:{toolName}"` records
 * with no key validation. The only place that knew the real set was the
 * dispatcher's `if` chain in tool-gateway, which meant the denominator --
 * how many tools the system claims to offer -- could not be counted without
 * reading that chain, and could change without anything noticing.
 *
 * Pinned here for the same reason NodeTypeSchema pins the eleven node types:
 * one declared set, one place to change it, and a catalogue that has to
 * agree with it. `apps/tool-gateway/src/gateway/tool-catalog.ts` records
 * which of these actually dispatch.
 *
 * Grouped by family, in dispatch order. Four families, eleven tools.
 */
export const ToolNameSchema = z.enum([
  // search -- Tavily
  "search.web",
  // database -- per-tenant database credentials
  "database.select",
  "database.insert",
  "database.update",
  "database.delete",
  // browser -- Browserbase
  "browser.session.create",
  "browser.navigate",
  "browser.click",
  "browser.extract",
  "browser.session.close",
  // email -- AWS SES
  "email.send",
]);

/** Every canonical tool name, in declaration order. */
export const TOOL_NAMES = ToolNameSchema.options;

export type ToolName = z.infer<typeof ToolNameSchema>;
