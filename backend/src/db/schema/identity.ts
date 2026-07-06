import { sqliteTable, text, check, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Identity domain (§3): users, guest sessions, agreement versions and consents.
 *
 * Real AI usage requires a valid agreement consent (ADR-020, §17.5). The
 * agreement text itself is a separate legal deliverable; only the version and
 * consent state live here.
 */

// §3.1 users
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    // NOTE: doc spec is `email TEXT NULL COLLATE NOCASE`; drizzle-orm columns
    // cannot express COLLATE, so the collation is omitted here. `auth_subject`
    // is the unique identity key, so NOCASE on email is non-critical.
    email: text('email'),
    authSubject: text('auth_subject').notNull().unique(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('users_status_check', sql`status IN ('active','disabled')`),
  ],
);

// §3.1.1 guest_sessions
export const guestSessions = sqliteTable(
  'guest_sessions',
  {
    id: text('id').primaryKey(),
    // HMAC-SHA-256(server_pepper, session_key) deterministic digest.
    sessionKeyDigest: text('session_key_digest').notNull().unique(),
    createdAt: text('created_at').notNull(),
    lastActiveAt: text('last_active_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [
    index('idx_guest_sessions_expires_at').on(t.expiresAt),
    index('idx_guest_sessions_last_active_at').on(t.lastActiveAt),
  ],
);

// §3.5.1 agreement_versions
export const agreementVersions = sqliteTable(
  'agreement_versions',
  {
    id: text('id').primaryKey(),
    version: text('version').notNull().unique(),
    status: text('status').notNull(),
    changeType: text('change_type').notNull(),
    effectiveAt: text('effective_at').notNull(),
    contentRef: text('content_ref').notNull(),
    // Self-reference declared as a table-level FK below (avoids circular type inference).
    supersededBy: text('superseded_by'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('agreement_versions_status_check', sql`status IN ('draft','active','superseded','withdrawn')`),
    check('agreement_versions_change_type_check', sql`change_type IN ('major','minor')`),
    // Self-reference: superseded_by -> agreement_versions(id) ON DELETE RESTRICT
    foreignKey({
      columns: [t.supersededBy],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
  ],
);

// §3.5.2 agreement_consents
export const agreementConsents = sqliteTable(
  'agreement_consents',
  {
    id: text('id').primaryKey(),
    agreementVersionId: text('agreement_version_id').notNull().references(() => agreementVersions.id, { onDelete: 'restrict' }),
    actorKind: text('actor_kind').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
    guestSessionId: text('guest_session_id').references(() => guestSessions.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    scope: text('scope').notNull(),
    channel: text('channel').notNull().default('web'),
    occurredAt: text('occurred_at').notNull(),
    receivedAt: text('received_at'),
  },
  (t) => [
    check('agreement_consents_actor_kind_check', sql`actor_kind IN ('user','guest')`),
    check('agreement_consents_action_check', sql`action IN ('accepted','reaccepted','withdrawn')`),
    check('agreement_consents_scope_check', sql`scope IN ('quick','formal','training','all')`),
    check('agreement_consents_channel_check', sql`channel IN ('web','cli','api')`),
    // user_id / guest_session_id XOR by actor_kind
    check(
      'agreement_consents_actor_xor',
      sql`(actor_kind='user' AND user_id IS NOT NULL AND guest_session_id IS NULL)
        OR (actor_kind='guest' AND user_id IS NULL AND guest_session_id IS NOT NULL)`,
    ),
    index('idx_agreement_consents_user_id').on(t.userId).where(sql`user_id IS NOT NULL`),
    index('idx_agreement_consents_guest_session_id').on(t.guestSessionId).where(sql`guest_session_id IS NOT NULL`),
    index('idx_agreement_consents_version').on(t.agreementVersionId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type GuestSession = typeof guestSessions.$inferSelect;
export type NewGuestSession = typeof guestSessions.$inferInsert;
export type AgreementVersion = typeof agreementVersions.$inferSelect;
export type NewAgreementVersion = typeof agreementVersions.$inferInsert;
export type AgreementConsent = typeof agreementConsents.$inferSelect;
export type NewAgreementConsent = typeof agreementConsents.$inferInsert;
