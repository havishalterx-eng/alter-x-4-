/**
 * Agent identity golden set v1 -- written before agents' instructions reached
 * the model, as the fixed target for making them do so (Phase 4.4, option a).
 *
 * The claim under test: binding a different agent to the same node changes
 * what the node produces, because the bound agent's instructions reach the
 * model. So every case pairs one node prompt with two agents whose
 * instructions demand different, mechanically checkable properties, and each
 * agent's output is checked for its own property -- including, where it can
 * be, the absence of the other agent's. A model that follows only the node
 * prompt cannot pass both halves of a pair.
 *
 * Properties are deliberately surface-level (a prefix, a field, a word limit,
 * letter case). They are not a quality bar; they make "the instructions were
 * followed" checkable without an LLM judge.
 */

export interface AgentIdentityCase {
  readonly id: string;
  readonly nodePrompt: string;
  readonly agentInstructions: string;
  /** Why the output fails, or undefined when it has the agent's property. */
  readonly check: (output: Record<string, unknown>) => string | undefined;
}

const words = (value: unknown): number => String(value ?? "").trim().split(/\s+/).filter(Boolean).length;

const ANNOUNCEMENT =
  'Write a short product update announcing that invoices can now be exported to CSV. Respond with JSON {"title": string, "body": string}.';
const TRIAGE =
  "Classify this support message and respond with JSON {\"category\": string, \"reply\": string}: 'My card was charged twice for the same order.'";
const NAMING =
  'Suggest a name for an internal tool that tracks laptop loans. Respond with JSON {"name": string}.';

export const AGENT_IDENTITY_CASES: readonly AgentIdentityCase[] = [
  {
    id: "announcement-brand-voice",
    nodePrompt: ANNOUNCEMENT,
    agentInstructions:
      "You write release notes for Northwind. Every title you write starts with the exact prefix 'Northwind update:'.",
    check: (output) =>
      String(output["title"] ?? "").startsWith("Northwind update:")
        ? undefined
        : `title does not start with 'Northwind update:' (${JSON.stringify(output["title"])})`,
  },
  {
    id: "announcement-executive-brief",
    nodePrompt: ANNOUNCEMENT,
    agentInstructions:
      "You write for busy executives. Every body you write is 20 words or fewer. Titles never mention a company name.",
    check: (output) => {
      if (words(output["body"]) > 20) return `body is ${words(output["body"])} words, over 20`;
      if (String(output["title"] ?? "").startsWith("Northwind")) return "title carries the other agent's prefix";
      return undefined;
    },
  },
  {
    id: "triage-escalation-policy",
    nodePrompt: TRIAGE,
    agentInstructions:
      "You triage for a payments team. Always add a boolean field needs_human_review, set to true whenever money may have been taken incorrectly.",
    check: (output) =>
      output["needs_human_review"] === true
        ? undefined
        : `needs_human_review is ${JSON.stringify(output["needs_human_review"])}, not true`,
  },
  {
    id: "triage-self-serve",
    nodePrompt: TRIAGE,
    agentInstructions:
      "You answer customers directly. Your JSON has exactly the fields category and reply, never any other field.",
    check: (output) => {
      const keys = Object.keys(output).sort();
      return keys.join(",") === "category,reply" ? undefined : `fields are ${keys.join(",")}`;
    },
  },
  {
    id: "naming-uppercase",
    nodePrompt: NAMING,
    agentInstructions: "Every name you propose is written in capital letters only, for example LOANDESK.",
    check: (output) => {
      const name = String(output["name"] ?? "");
      return /[A-Z]/.test(name) && name === name.toUpperCase() ? undefined : `name ${JSON.stringify(name)} is not all capitals`;
    },
  },
  {
    id: "naming-single-lowercase-word",
    nodePrompt: NAMING,
    agentInstructions: "Every name you propose is one lowercase word: letters a to z only, no spaces, no capitals.",
    check: (output) => {
      const name = String(output["name"] ?? "");
      return /^[a-z]+$/.test(name) ? undefined : `name ${JSON.stringify(name)} is not one lowercase word`;
    },
  },
];
