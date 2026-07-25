// Fixed intent taxonomy for the Conversation Manager (INGR-4). Not defined
// anywhere else in the codebase yet, so it's defined here and documented:
// every utterance the Conversation Manager classifies must resolve to
// exactly one of these five values, matching the five categories a user's
// utterance can fall into -- answer a question, make a plan, run a
// workflow, execute something, or modify something.
//
// "answer" is the only non-actionable intent: it means the user wants
// information back, not a change to any goal state or system. Every other
// intent is actionable -- it implies the Conversation Manager should
// progress or start a goal.
export const INTENT_VALUES = [
  "answer",
  "plan",
  "workflow",
  "execute",
  "modify",
] as const;

export type Intent = (typeof INTENT_VALUES)[number];

export function isIntent(value: string): value is Intent {
  return (INTENT_VALUES as readonly string[]).includes(value);
}

export function isActionableIntent(intent: Intent): boolean {
  return intent !== "answer";
}

// Goal-state status taxonomy. Also undefined elsewhere, defined here:
// - planning: goal state exists but the Conversation Manager hasn't
//   gathered enough information to act yet.
// - awaiting_clarification: at least one clarification question is
//   outstanding (see pendingClarifications in the goal state JSON shape
//   below) and the goal cannot progress until it's answered.
// - ready: all required information is present; the goal is ready to be
//   handed off for execution.
// - executing: the goal has been handed off and is actively running.
export const GOAL_STATE_STATUS_VALUES = [
  "planning",
  "awaiting_clarification",
  "ready",
  "executing",
] as const;

export type GoalStateStatus = (typeof GOAL_STATE_STATUS_VALUES)[number];

// Shape of the JSON stored in conversation_goal_states.goal_state_json.
// pendingClarifications is keyed by clarification_id -> answer, merged in
// by mergeClarification(). Anything else about the goal (the plan itself,
// tool selections, etc.) is intentionally left open-ended for future
// tickets -- this ticket only owns the clarification-merge mechanics.
export interface GoalState {
  readonly pendingClarifications: Readonly<Record<string, string>>;
}

export function emptyGoalState(): GoalState {
  return { pendingClarifications: {} };
}
