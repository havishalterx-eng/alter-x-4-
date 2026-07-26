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
// by mergeClarification() (INGR-4). pendingQuestions is the companion
// keyed by clarification_id -> question text, populated by the
// Clarification Loop (PLAN-5) when it sets status to
// awaiting_clarification, so a caller holding only a clarification_id can
// recover what question it answers. taskSkeletonJson is the Planner's
// last Decompose result once the goal reaches "ready" -- a plain string
// (not re-parsed here), same treatment DecomposeResponse.task_skeleton_json
// gets on the Planner side.
//
// pendingQuestions/taskSkeletonJson are optional, not just possibly-empty:
// the column's real Postgres default is a bare `{}` (jsonb(...).default({})),
// so a row untouched by the Clarification Loop won't have these keys at
// all -- readers must not assume their presence.
export interface GoalState {
  readonly pendingClarifications: Readonly<Record<string, string>>;
  readonly pendingQuestions?: Readonly<Record<string, string>>;
  readonly taskSkeletonJson?: string | null;
}

export function emptyGoalState(): GoalState {
  return {
    pendingClarifications: {},
    pendingQuestions: {},
    taskSkeletonJson: null,
  };
}
