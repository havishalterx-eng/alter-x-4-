import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  region: text("region").notNull().default("ap-south-1"),
  identityOrgRef: text("identity_org_ref"),
  dataResidency: jsonb("data_residency"),
  retentionOverrides: jsonb("retention_overrides"),
  securityPolicy: jsonb("security_policy"),
  ssoConfig: jsonb("sso_config"),
  billingProfileId: uuid("billing_profile_id"),
  createdAt,
  updatedAt,
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    status: text("status").notNull(),
    defaultModelPolicy: jsonb("default_model_policy"),
    defaultToolPolicy: jsonb("default_tool_policy"),
    budget: jsonb("budget"),
    adsScopeId: uuid("ads_scope_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("workspaces_tenant_id_name_unique").on(table.tenantId, table.name),
  ],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  identityRef: text("identity_ref").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  status: text("status").notNull(),
  createdAt,
  updatedAt,
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("tenant_members_tenant_id_user_id_unique").on(
      table.tenantId,
      table.userId,
    ),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("workspace_members_workspace_id_user_id_unique").on(
      table.workspaceId,
      table.userId,
    ),
  ],
);

export const entitlements = pgTable("entitlements", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  plan: text("plan").notNull(),
  limits: jsonb("limits"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdAt,
});

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  accessTokenHash: text("access_token_hash").notNull(),
  deviceInfo: jsonb("device_info"),
  ip: text("ip"),
  createdAt,
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
