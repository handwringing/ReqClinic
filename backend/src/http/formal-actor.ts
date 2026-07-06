import { ApiError } from './errors';
import type { Actor, RouteContext } from './route-registry';
import { env } from '../config/env';
import type { AgreementRepo } from '../repo/agreement-repo';
import type { UserRepo } from '../repo/user-repo';

export interface FormalActorDeps {
  userRepo: UserRepo;
  agreementRepo?: AgreementRepo;
}

/**
 * Resolve the user id that owns a formal project action.
 *
 * Production formal projects remain user-owned. In local development we allow
 * a guest to exercise the formal-project demo through one stable local user.
 * This keeps project/member/job constraints intact instead of weakening the
 * formal schema to support guest ownership, and it keeps demo projects
 * reachable after a server restart or guest-session refresh.
 */
export async function resolveFormalUserId(
  ctx: RouteContext,
  deps: FormalActorDeps,
): Promise<string> {
  if (ctx.actor.kind === 'user' && ctx.actor.userId) {
    return ctx.actor.userId;
  }
  if (ctx.actor.kind !== 'guest' || !ctx.actor.guestSessionId) {
    throw ApiError.unauthenticated();
  }
  if (env.NODE_ENV === 'production') {
    throw ApiError.unauthenticated();
  }

  const authSubject = 'reqclinic:formal-demo:local-user';
  const existing = await deps.userRepo.findByAuthSubject(authSubject);
  const user =
    existing ??
    (await deps.userRepo.create({
      displayName: '本地体验用户',
      authSubject,
      email: null,
    }));

  if (deps.agreementRepo) {
    await ensureAgreementForUser(deps.agreementRepo, user.id);
  }
  return user.id;
}

export function formalUserActor(userId: string): Actor {
  return { kind: 'user', userId };
}

async function ensureAgreementForUser(repo: AgreementRepo, userId: string): Promise<void> {
  const ok = await repo.hasValidConsent({ userId });
  if (ok) return;
  const active = await repo.getActiveVersion();
  if (!active) return;
  await repo.createConsent({
    agreementVersionId: active.id,
    actorKind: 'user',
    userId,
  });
}
