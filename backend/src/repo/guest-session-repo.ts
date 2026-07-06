import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { guestSessions } from '../db/schema/identity';
import { hmacDigest, timingSafeEqualHex } from '../shared/crypto';
import { generateId } from '../shared/id';
import { now, addDays, isExpired } from '../shared/time';

export interface GuestSessionRecord {
  id: string;
  sessionKeyDigest: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export interface CreatedGuestSession {
  /** Opaque session credential — only returned once at creation time. */
  sessionKey: string;
  id: string;
  createdAt: string;
  expiresAt: string;
}

/** 30-day sliding expiry for guest sessions (§3.1.1). */
const GUEST_SESSION_TTL_DAYS = 30;

/**
 * Repository for the `guest_sessions` table (§3.1.1).
 *
 * Stores only the HMAC-SHA-256 digest of the `session_key`; the raw key is
 * returned to the caller exactly once, at creation time, and never persisted.
 */
export class GuestSessionRepo {
  constructor(private db: DrizzleDB, private pepper: string) {}

  /**
   * Issue a fresh guest session.
   *
   * Generates a 256-bit `session_key` (base64url), persists only its
   * pepper-keyed HMAC digest, and returns the raw key once.
   */
  async create(): Promise<CreatedGuestSession> {
    const sessionKey = randomBytes(32).toString('base64url');
    const digest = hmacDigest(this.pepper, sessionKey);
    const ts = now();
    const id = generateId('gst');
    const expiresAt = addDays(ts, GUEST_SESSION_TTL_DAYS);

    await this.db.insert(guestSessions).values({
      id,
      sessionKeyDigest: digest,
      createdAt: ts,
      lastActiveAt: ts,
      expiresAt,
    });

    return { id, sessionKey, createdAt: ts, expiresAt };
  }

  /**
   * Look up a session by its raw `sessionKey`.
   *
   * Computes the digest and does an index lookup, then verifies the match in
   * constant time via `timingSafeEqualHex` as a defence-in-depth measure.
   * Returns `null` when the key is unknown or the digest comparison fails.
   */
  async findBySessionKey(sessionKey: string): Promise<GuestSessionRecord | null> {
    const digest = hmacDigest(this.pepper, sessionKey);
    const rows = await this.db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.sessionKeyDigest, digest))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    if (!timingSafeEqualHex(row.sessionKeyDigest, digest)) return null;
    return { ...row };
  }

  /**
   * Look up a session by its row id (after the auth middleware has already
   * resolved the actor). Returns the full record so handlers can surface
   * `created_at` / `last_active_at` without re-holding the raw session key.
   */
  async findById(id: string): Promise<GuestSessionRecord | null> {
    const rows = await this.db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return { ...rows[0] };
  }

  /**
   * Refresh `last_active_at` and extend `expires_at` by the TTL on activity.
   */
  async touch(id: string): Promise<void> {
    const ts = now();
    await this.db
      .update(guestSessions)
      .set({ lastActiveAt: ts, expiresAt: addDays(ts, GUEST_SESSION_TTL_DAYS) })
      .where(eq(guestSessions.id, id));
  }

  /**
   * True when a session row exists and has not expired.
   */
  async exists(id: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, id))
      .limit(1);
    if (rows.length === 0) return false;
    return !isExpired(rows[0].expiresAt);
  }
}
