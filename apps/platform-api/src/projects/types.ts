import type { JsonValue } from "@alterx/shared-clients";

export interface CreateProjectInput {
  brief: string;
}

export interface ClarificationAnswerInput {
  answer: string;
}

export interface RejectPlanInput {
  reason: string;
}

export interface RequestPlanChangesInput {
  changes: string;
}

export type EmptyProjectActionInput = Record<string, never>;

export interface ProjectResource {
  project_id: string;
  workspace_id: string;
  status: string;
  brief: string;
  [key: string]: JsonValue;
}

export interface ProjectClarification {
  clarification_id: string;
  question: string;
  options: string[];
  required: boolean;
}

export interface ProjectClarificationList {
  data: ProjectClarification[];
}

export interface ProjectPlan {
  project_id: string;
  version: number;
  status: string;
  steps: JsonValue[];
  [key: string]: JsonValue;
}

export interface ProjectActionResult {
  project_id: string;
  action: string;
  status: string;
  [key: string]: JsonValue;
}

export interface ProjectBuild {
  project_id: string;
  build_id: string;
  status: string;
  [key: string]: JsonValue;
}
