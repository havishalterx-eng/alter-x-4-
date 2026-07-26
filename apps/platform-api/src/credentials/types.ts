export interface CredentialRecord {
  tenantId: string;
  id: string;
  name: string;
  connector: string;
  scope: string;
  last4: string;
  useAuditPtr: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialView {
  id: string;
  name: string;
  connector: string;
  scope: string;
  last4: string;
  created_at: string;
  version: string;
}

export interface CreateCredentialInput {
  name: string;
  connector: string;
  scope: string;
  value: string;
}

export interface UpdateCredentialInput {
  name?: string;
  connector?: string;
  scope?: string;
  value?: string;
}
