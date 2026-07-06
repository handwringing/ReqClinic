import { eq, and, desc, inArray } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  agreementVersions,
  agreementConsents,
  type AgreementVersion,
  type AgreementConsent,
} from '../db/schema/identity';
export type { AgreementVersion, AgreementConsent };
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export interface ActorRef {
  userId?: string;
  guestSessionId?: string;
}

export interface CreateConsentInput {
  agreementVersionId: string;
  actorKind: 'user' | 'guest';
  userId?: string;
  guestSessionId?: string;
  /** Consent action to record; defaults to `accepted` (§3B.2). `reaccepted` is used for major-update reconsent (§3B.3). */
  action?: 'accepted' | 'reaccepted';
}

/**
 * Repository for `agreement_versions` (§3.5.1) and `agreement_consents`
 * (§3.5.2).
 *
 * Consent withdrawal is modelled as a separate `action='withdrawn'` row rather
 * than a `withdrawn_at` column, so `hasValidConsent` checks that the latest
 * consent action for the active version is `accepted` or `reaccepted`.
 */
export class AgreementRepo {
  constructor(private db: DrizzleDB) {}

  /** The latest `agreement_versions` row with `status='active'`. */
  async getActiveVersion(): Promise<AgreementVersion | null> {
    const rows = await this.db
      .select()
      .from(agreementVersions)
      .where(eq(agreementVersions.status, 'active'))
      .orderBy(desc(agreementVersions.effectiveAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The latest consent row for the actor (any action, any version). */
  async findConsentByActor(actor: ActorRef): Promise<AgreementConsent | null> {
    const rows = await this.db
      .select()
      .from(agreementConsents)
      .where(this.actorCondition(actor))
      .orderBy(desc(agreementConsents.occurredAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * True when the actor's latest action for the active version is an
   * acceptance (not a withdrawal).
   *
   * Compares the latest `accepted`/`reaccepted` timestamp against the latest
   * `withdrawn` timestamp. A tie means both happened in the same clock tick;
   * the withdrawal is the later action and therefore invalidates consent. This
   * avoids relying on `ORDER BY occurred_at` to break ties deterministically
   * (the table has a text PK, not an auto-increment rowid).
   */
  async hasValidConsent(actor: ActorRef): Promise<boolean> {
    const active = await this.getActiveVersion();
    if (!active) return false;

    const acceptedRows = await this.db
      .select({ occurredAt: agreementConsents.occurredAt })
      .from(agreementConsents)
      .where(
        and(
          this.actorCondition(actor),
          eq(agreementConsents.agreementVersionId, active.id),
          inArray(agreementConsents.action, ['accepted', 'reaccepted']),
        ),
      )
      .orderBy(desc(agreementConsents.occurredAt))
      .limit(1);
    if (acceptedRows.length === 0) return false;

    const withdrawnRows = await this.db
      .select({ occurredAt: agreementConsents.occurredAt })
      .from(agreementConsents)
      .where(
        and(
          this.actorCondition(actor),
          eq(agreementConsents.agreementVersionId, active.id),
          eq(agreementConsents.action, 'withdrawn'),
        ),
      )
      .orderBy(desc(agreementConsents.occurredAt))
      .limit(1);
    if (withdrawnRows.length === 0) return true;

    return acceptedRows[0].occurredAt > withdrawnRows[0].occurredAt;
  }

  /** Insert an `accepted` (or `reaccepted`) consent row for the actor. */
  async createConsent(input: CreateConsentInput): Promise<AgreementConsent> {
    const id = generateId('agrc');
    const ts = now();
    await this.db.insert(agreementConsents).values({
      id,
      agreementVersionId: input.agreementVersionId,
      actorKind: input.actorKind,
      userId: input.userId ?? null,
      guestSessionId: input.guestSessionId ?? null,
      action: input.action ?? 'accepted',
      scope: 'all',
      channel: 'web',
      occurredAt: ts,
      receivedAt: ts,
    });
    const row = await this.findById(id);
    return row!;
  }

  /**
   * Record a withdrawal for the same actor + version as `consentId`.
   *
   * Because the schema has no `withdrawn_at` column, withdrawal is an
   * `action='withdrawn'` event row mirroring the original consent's scope and
   * actor fields.
   */
  async withdrawConsent(consentId: string): Promise<AgreementConsent> {
    const original = await this.findById(consentId);
    if (!original) {
      throw new Error(`Consent ${consentId} not found`);
    }
    const id = generateId('agrc');
    const ts = now();
    await this.db.insert(agreementConsents).values({
      id,
      agreementVersionId: original.agreementVersionId,
      actorKind: original.actorKind,
      userId: original.userId,
      guestSessionId: original.guestSessionId,
      action: 'withdrawn',
      scope: original.scope,
      channel: original.channel,
      occurredAt: ts,
      receivedAt: ts,
    });
    const row = await this.findById(id);
    return row!;
  }

  /** Consent history for the actor, newest first. */
  async listConsents(actor: ActorRef): Promise<AgreementConsent[]> {
    const rows = await this.db
      .select()
      .from(agreementConsents)
      .where(this.actorCondition(actor))
      .orderBy(desc(agreementConsents.occurredAt));
    return rows;
  }

  async findById(id: string): Promise<AgreementConsent | null> {
    const rows = await this.db
      .select()
      .from(agreementConsents)
      .where(eq(agreementConsents.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  private actorCondition(actor: ActorRef) {
    return actor.userId
      ? eq(agreementConsents.userId, actor.userId)
      : eq(agreementConsents.guestSessionId, actor.guestSessionId!);
  }
}
