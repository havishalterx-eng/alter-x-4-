export interface EnvVarRecord {
  tenantId: string;
  id: string;
  projectId: string;
  environment: string;
  key: string;
  last4: string;
  useAuditPtr: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnvVarView {
  id: string;
  project_id: string;
  environment: string;
  key: string;
  last4: string;
  created_at: string;
  version: string;
}

export interface CreateEnvVarInput {
  environment: string;
  key: string;
  value: string;
}

export interface UpdateEnvVarInput {
  environment?: string;
  key?: string;
  value?: string;
}
