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

/**
 * What the engine's project read routes return, which is not the shape
 * ProjectResource describes: the create route answers with the planning
 * resource above, while the read routes answer from the `projects` table
 * (0019_create_projects.sql) in camelCase.
 */
export interface ProjectRecord {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}

export interface ProjectList {
  data: ProjectRecord[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
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
