import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { users } from '../db/schema/identity';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export interface UserRecord {
  id: string;
  displayName: string;
  email: string | null;
  authSubject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  displayName: string;
  authSubject: string;
  email?: string | null;
}

/**
 * Repository for the `users` table (§3.1).
 *
 * Returns plain objects stripped of Drizzle metadata so handlers never leak
 * internal query-builder state.
 */
export class UserRepo {
  constructor(private db: DrizzleDB) {}

  async findById(id: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? this.strip(rows[0]) : null;
  }

  async findByAuthSubject(authSubject: string): Promise<UserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.authSubject, authSubject))
      .limit(1);
    return rows[0] ? this.strip(rows[0]) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const ts = now();
    const id = generateId('usr');
    await this.db.insert(users).values({
      id,
      displayName: input.displayName,
      email: input.email ?? null,
      authSubject: input.authSubject,
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    });
    const row = await this.findById(id);
    return row!;
  }

  private strip(row: typeof users.$inferSelect): UserRecord {
    return {
      id: row.id,
      displayName: row.displayName,
      email: row.email,
      authSubject: row.authSubject,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
