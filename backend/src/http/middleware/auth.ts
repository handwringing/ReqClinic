import type { FastifyRequest } from 'fastify';
import { eq, and } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/client';
import { projectMembers } from '../../db/schema/project';
import { ApiError } from '../errors';
import type { Actor } from '../route-registry';
import type { UserRepo } from '../../repo/user-repo';
import type { GuestSessionRepo } from '../../repo/guest-session-repo';

export interface AuthMiddlewareDeps {
  userRepo: UserRepo;
  guestSessionRepo: GuestSessionRepo;
}

/**
 * Auth middleware factory.
 *
 * Returns `resolveActor` for the RouteRegistry's `resolveActor` hook. Reads the
 * `guest_session` Cookie (raw session key) and optionally the `auth_session`
 * Cookie (user id). A user Cookie takes precedence over a guest Cookie.
 */
export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  async function resolveActor(req: FastifyRequest): Promise<Actor> {
    const cookies = (req as any).cookies ?? {};

    let actor: Actor = { kind: 'unauthenticated' };

    // Guest session cookie first.
    const guestKey = cookies['guest_session'] as string | undefined;
    if (guestKey) {
      const session = await deps.guestSessionRepo.findBySessionKey(guestKey);
      if (session) {
        await deps.guestSessionRepo.touch(session.id);
        actor = { kind: 'guest', guestSessionId: session.id };
      }
    }

    // An auth Cookie overrides the guest actor.
    const authSession = cookies['auth_session'] as string | undefined;
    if (authSession) {
      actor = { kind: 'user', userId: authSession };
    }

    return actor;
  }

  return { resolveActor };
}

/** Throw 401 when the actor is not a logged-in user. */
export function requireUser(actor: Actor): void {
  if (actor.kind !== 'user') {
    throw ApiError.unauthenticated();
  }
}

/** Throw 401 when the actor is neither a guest nor a user. */
export function requireActor(actor: Actor): void {
  if (actor.kind !== 'guest' && actor.kind !== 'user') {
    throw ApiError.unauthenticated();
  }
}

/**
 * Verify that the actor is an active project member with `capability`.
 *
 * Throws `ApiError.unauthenticated()` when not a user, and `ApiError.forbidden()`
 * when the membership is missing, revoked, or lacks the capability.
 */
export async function requireProjectCapability(
  actor: Actor,
  db: DrizzleDB,
  projectId: string,
  capability: string,
): Promise<void> {
  requireUser(actor);
  const userId = actor.userId!;

  const rows = await db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
        eq(projectMembers.status, 'active'),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw ApiError.forbidden();
  }

  const capabilities = JSON.parse(rows[0].capabilitiesJson) as string[];
  if (!capabilities.includes(capability)) {
    throw ApiError.forbidden();
  }
}
