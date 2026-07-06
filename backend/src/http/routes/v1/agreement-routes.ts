import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireActor } from '../../middleware/auth';
import type { AgreementRepo, AgreementConsent } from '../../../repo/agreement-repo';
import type { JobRepo } from '../../../repo/job-repo';

/**
 * Agreement consent routes (Task 12, §3B).
 *
 * Covers the active-version lookup, first/non-major accept, major-update
 * reaccept, withdrawal, and the actor-scoped consent history. The operator
 * identity is always derived from the auth context — request bodies never
 * carry actor fields (enforced by `additionalProperties: false` upstream).
 *
 * Withdrawal additionally cancels queued AI jobs for the actor (§3B.4) when
 * `jobRepo` is wired.
 */
export interface AgreementRouteDeps {
  agreementRepo: AgreementRepo;
  /** Optional: when wired, withdrawal cancels queued jobs for the actor. */
  jobRepo?: JobRepo;
}

/** snake_case mapper for the `Agreement` schema (§3B.1). */
function mapAgreementVersion(v: {
  id: string;
  version: string;
  changeType: string;
  effectiveAt: string;
  contentRef: string;
}) {
  return {
    id: v.id,
    version: v.version,
    change_type: v.changeType,
    effective_at: v.effectiveAt,
    content_ref: v.contentRef,
  };
}

/** snake_case mapper for an `AgreementConsent` row (§3B.5). */
function mapConsent(c: AgreementConsent) {
  return {
    id: c.id,
    agreement_version_id: c.agreementVersionId,
    actor_kind: c.actorKind,
    actor_id: c.userId ?? c.guestSessionId,
    action: c.action,
    scope: c.scope,
    occurred_at: c.occurredAt,
    received_at: c.receivedAt,
  };
}

const VALID_SCOPES: ReadonlySet<string> = new Set([
  'quick',
  'formal',
  'training',
  'all',
]);

export function registerAgreementRoutes(
  registry: RouteRegistry,
  deps: AgreementRouteDeps,
): void {
  // getActiveAgreement ─ GET /api/v1/agreements/active
  registry.register('getActiveAgreement', async (_ctx: RouteContext) => {
    const version = await deps.agreementRepo.getActiveVersion();
    if (!version) {
      throw ApiError.notFound(
        'No active agreement version',
        'agreement_version',
      );
    }
    return mapAgreementVersion(version);
  });

  // acceptAgreement ─ POST /api/v1/agreements/:versionId/accept
  registry.register(
    'acceptAgreement',
    async (ctx: RouteContext) => {
      requireActor(ctx.actor);
      const body = ctx.body ?? {};
      const scope = body.scope;
      if (typeof scope !== 'string' || !VALID_SCOPES.has(scope)) {
        throw ApiError.validationError({ scope: 'required field missing or invalid' });
      }

      const consent = await deps.agreementRepo.createConsent({
        agreementVersionId: ctx.params.versionId,
        actorKind: ctx.actor.kind as 'user' | 'guest',
        userId: ctx.actor.userId,
        guestSessionId: ctx.actor.guestSessionId,
        action: 'accepted',
      });

      return {
        consent_id: consent.id,
        agreement_version_id: consent.agreementVersionId,
        action: consent.action,
        occurred_at: consent.occurredAt,
      };
    },
    { idempotent: true },
  );

  // reacceptAgreement ─ POST /api/v1/agreements/:versionId/reaccept
  registry.register(
    'reacceptAgreement',
    async (ctx: RouteContext) => {
      requireActor(ctx.actor);
      const body = ctx.body ?? {};
      const scope = body.scope;
      if (typeof scope !== 'string' || !VALID_SCOPES.has(scope)) {
        throw ApiError.validationError({ scope: 'required field missing or invalid' });
      }

      // Reaccept forms a new `reaccepted` row; it does not overwrite prior
      // records or retroactively change their legality (§3B.3).
      const consent = await deps.agreementRepo.createConsent({
        agreementVersionId: ctx.params.versionId,
        actorKind: ctx.actor.kind as 'user' | 'guest',
        userId: ctx.actor.userId,
        guestSessionId: ctx.actor.guestSessionId,
        action: 'reaccepted',
      });

      return {
        consent_id: consent.id,
        agreement_version_id: consent.agreementVersionId,
        action: consent.action,
        occurred_at: consent.occurredAt,
      };
    },
    { idempotent: true },
  );

  // withdrawAgreementConsent ─ POST /api/v1/agreements/consents/:id/withdraw
  registry.register(
    'withdrawAgreementConsent',
    async (ctx: RouteContext) => {
      requireActor(ctx.actor);
      const consentId = ctx.params.id;
      const existing = await deps.agreementRepo.findById(consentId);
      if (!existing) {
        throw ApiError.notFound('Consent not found', 'agreement_consent');
      }
      // Only the current actor may withdraw their own consent; non-ownership
      // is folded into 404 so existence is not enumerable (§3B.4).
      const owns =
        ctx.actor.kind === 'user'
          ? existing.userId === ctx.actor.userId
          : existing.guestSessionId === ctx.actor.guestSessionId;
      if (!owns) {
        throw ApiError.notFound('Consent not found', 'agreement_consent');
      }

      const withdrawn = await deps.agreementRepo.withdrawConsent(consentId);

      // §3B.4: withdrawing consent blocks new model calls (enforced by the
      // agreement gate via hasValidConsent) AND cancels already-queued AI
      // jobs for this actor so they are not dispatched after opt-out. Jobs
      // already running/validating are left to complete naturally.
      let cancelledJobs = 0;
      if (deps.jobRepo) {
        const actorKind = ctx.actor.kind as 'user' | 'guest';
        const actorId = ctx.actor.userId ?? ctx.actor.guestSessionId!;
        cancelledJobs = deps.jobRepo.cancelQueuedByActor(actorKind, actorId);
      }

      return {
        data: {
          consent_id: withdrawn.id,
          action: withdrawn.action,
          occurred_at: withdrawn.occurredAt,
          cancelled_jobs: cancelledJobs,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { idempotent: true },
  );

  // listAgreementConsents ─ GET /api/v1/agreements/consents
  registry.register('listAgreementConsents', async (ctx: RouteContext) => {
    requireActor(ctx.actor);
    const consents = await deps.agreementRepo.listConsents({
      userId: ctx.actor.userId,
      guestSessionId: ctx.actor.guestSessionId,
    });
    return { data: consents.map(mapConsent), meta: {} };
  });
}
