import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";

export interface UserProfileRow {
  id: string;
  email: string;
  display_name: string | null;
}

@Injectable()
export class UserProfileRepository {
  constructor(private readonly pool: Pool | undefined) {}

  async findById(userId: string): Promise<UserProfileRow | null> {
    if (!this.pool) {
      return null;
    }
    const result = await this.pool.query<UserProfileRow>(
      "SELECT id, email, display_name FROM users WHERE id = $1",
      [userId],
    );
    return result.rows[0] ?? null;
  }
}
