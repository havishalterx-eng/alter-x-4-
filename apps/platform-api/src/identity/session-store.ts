import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { SessionRecord } from "./identity-provider.interface";

export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  refreshTokenHash: string;
  accessTokenHash: string;
  deviceInfo?: Record<string, unknown>;
  ip?: string;
}

export interface SessionStore {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findByRefreshTokenHash(hash: string): Promise<SessionRecord | undefined>;
  findByAccessTokenHash(hash: string): Promise<SessionRecord | undefined>;
  rotateRefreshToken(
    sessionId: string,
    previousHash: string,
    nextRefreshHash: string,
    nextAccessHash: string,
  ): Promise<boolean>;
  listActive(userId: string): Promise<SessionRecord[]>;
  revoke(userId: string, sessionId: string): Promise<void>;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<
    string,
    SessionRecord & { refreshTokenHash: string; accessTokenHash: string }
  >();

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const now = new Date();
    const session: SessionRecord & {
      refreshTokenHash: string;
      accessTokenHash: string;
    } = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      createdAt: now,
      lastSeenAt: now,
      refreshTokenHash: input.refreshTokenHash,
      accessTokenHash: input.accessTokenHash,
    };
    if (input.deviceInfo) {
      session.deviceInfo = input.deviceInfo;
    }
    if (input.ip) {
      session.ip = input.ip;
    }

    this.sessions.set(session.id, session);
    return withoutHashes(session);
  }

  async findByRefreshTokenHash(hash: string): Promise<SessionRecord | undefined> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === hash && !session.revokedAt) {
        return withoutHashes(session);
      }
    }

    return undefined;
  }

  async findByAccessTokenHash(hash: string): Promise<SessionRecord | undefined> {
    for (const session of this.sessions.values()) {
      if (session.accessTokenHash === hash && !session.revokedAt) {
        return withoutHashes(session);
      }
    }

    return undefined;
  }

  async rotateRefreshToken(
    sessionId: string,
    previousHash: string,
    nextRefreshHash: string,
    nextAccessHash: string,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt || session.refreshTokenHash !== previousHash) {
      return false;
    }

    session.refreshTokenHash = nextRefreshHash;
    session.accessTokenHash = nextAccessHash;
    session.lastSeenAt = new Date();
    return true;
  }

  async listActive(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId && !session.revokedAt)
      .map(withoutHashes);
  }

  async revoke(userId: string, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.userId === userId && !session.revokedAt) {
      session.revokedAt = new Date();
    }
  }
}

export class PgSessionStore implements SessionStore {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const id = randomUUID();
    const { rows } = await this.withTenant(input.tenantId, (client) =>
      client.query<SessionRow>(
        `INSERT INTO user_sessions
          (id, user_id, tenant_id, refresh_token_hash, access_token_hash, device_info, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          id,
          input.userId,
          input.tenantId,
          input.refreshTokenHash,
          input.accessTokenHash,
          input.deviceInfo ?? null,
          input.ip ?? null,
        ],
      ),
    );

    return mapSessionRow(rows[0]);
  }

  async findByRefreshTokenHash(hash: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM user_sessions
       WHERE refresh_token_hash = $1 AND revoked_at IS NULL
       LIMIT 1`,
      [hash],
    );

    return rows[0] ? mapSessionRow(rows[0]) : undefined;
  }

  async findByAccessTokenHash(hash: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM user_sessions
       WHERE access_token_hash = $1 AND revoked_at IS NULL
       LIMIT 1`,
      [hash],
    );

    return rows[0] ? mapSessionRow(rows[0]) : undefined;
  }

  async rotateRefreshToken(
    sessionId: string,
    previousHash: string,
    nextRefreshHash: string,
    nextAccessHash: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE user_sessions
       SET refresh_token_hash = $1, access_token_hash = $2, last_seen_at = now()
       WHERE id = $3 AND refresh_token_hash = $4 AND revoked_at IS NULL`,
      [nextRefreshHash, nextAccessHash, sessionId, previousHash],
    );

    return rowCount === 1;
  }

  async listActive(userId: string): Promise<SessionRecord[]> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY last_seen_at DESC`,
      [userId],
    );

    return rows.map(mapSessionRow);
  }

  async revoke(userId: string, sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions
       SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
  }

  private async withTenant<T>(
    tenantId: string,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
        tenantId,
      ]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface SessionRow {
  id: string;
  user_id: string;
  tenant_id: string;
  device_info: Record<string, unknown> | null;
  ip: string | null;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
}

function mapSessionRow(row: SessionRow | undefined): SessionRecord {
  if (!row) {
    throw new Error("Session row not found");
  }

  const session: SessionRecord = {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
  if (row.device_info) {
    session.deviceInfo = row.device_info;
  }
  if (row.ip) {
    session.ip = row.ip;
  }
  if (row.revoked_at) {
    session.revokedAt = row.revoked_at;
  }

  return session;
}

function withoutHashes(
  session: SessionRecord & { refreshTokenHash: string; accessTokenHash: string },
): SessionRecord {
  const record: SessionRecord = {
    id: session.id,
    userId: session.userId,
    tenantId: session.tenantId,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
  };
  if (session.deviceInfo) {
    record.deviceInfo = session.deviceInfo;
  }
  if (session.ip) {
    record.ip = session.ip;
  }
  if (session.revokedAt) {
    record.revokedAt = session.revokedAt;
  }

  return record;
}
