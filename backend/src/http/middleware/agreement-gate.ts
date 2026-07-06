import { ApiError } from '../errors';
import type { Actor, RouteContext } from '../route-registry';
import type { AgreementRepo } from '../../repo/agreement-repo';

export interface AgreementGateDeps {
  agreementRepo: AgreementRepo;
}

/**
 * operationIds that require a valid agreement consent before the handler runs
 * (API §2.2). These are the operations that trigger real AI or persistent
 * resource creation.
 */
export const AGREEMENT_GATED_OPERATIONS: ReadonlySet<string> = new Set([
  'createProject',
  'postFormalProjectMessage',
  'createAnalysisRun',
  'compileReport',
  'createQuickSession',
  'postQuickSessionMessage',
  'reviewQuickSessionUnderstanding',
  'recordQuickSessionOptionPreference',
  'generateQuickSessionBrief',
  'upgradeQuickSession',
  'createTrainingAttempt',
  'postTrainingQuestion',
]);

/**
 * Agreement-gate middleware factory.
 *
 * Returns `checkAgreement` for the RouteRegistry's `checkAgreement` hook. Throws
 * `ApiError.agreementRequired()` (403) when the actor has no valid consent for
 * the currently-active agreement version.
 */
export function createAgreementGate(deps: AgreementGateDeps) {
  async function checkAgreement(actor: Actor): Promise<void> {
    if (actor.kind === 'unauthenticated') {
      throw ApiError.unauthenticated();
    }
    const ok = await deps.agreementRepo.hasValidConsent({
      userId: actor.userId,
      guestSessionId: actor.guestSessionId,
    });
    if (!ok) {
      throw ApiError.agreementRequired();
    }
  }

  return { checkAgreement };
}

// Re-export for the RouteDeps signature that receives a RouteContext.
export type CheckAgreementFn = (ctx: RouteContext) => Promise<void> | void;
