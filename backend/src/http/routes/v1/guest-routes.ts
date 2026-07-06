import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireUser } from '../../middleware/auth';
import { env } from '../../../config/env';
import type { GuestSessionRepo } from '../../../repo/guest-session-repo';
import type { QuickSessionRepo } from '../../../repo/quick-session-repo';

/**
 * Guest session & quick-session claim routes (Task 11, §3A).
 *
 * `createGuestSession` is the only public write that mints a credential; the
 * raw `session_key` is returned exactly once and mirrored into an HttpOnly
 * cookie. `claimQuickSession` requires dual proof (logged-in user + guest
 * credential matching the session's owner) and atomically transfers ownership.
 */
export interface GuestRouteDeps {
  guestSessionRepo: GuestSessionRepo;
  quickSessionRepo: QuickSessionRepo;
}

export function registerGuestRoutes(
  registry: RouteRegistry,
  deps: GuestRouteDeps,
): void {
  // createGuestSession ─ POST /api/v1/guest-sessions
  registry.register('createGuestSession', async (ctx: RouteContext) => {
    const session = await deps.guestSessionRepo.create();
    // `Secure` is only set in production: dev/test run over HTTP, where a
    // Secure cookie would be dropped by the client (§3A.1).
    const secure = env.NODE_ENV === 'production';
    ctx.reply?.setCookie('guest_session', session.sessionKey, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
    });
    return {
      id: session.id,
      session_key: session.sessionKey,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
    };
  });

  // getCurrentGuestSession ─ GET /api/v1/guest-sessions/current
  registry.register('getCurrentGuestSession', async (ctx: RouteContext) => {
    const guestSessionId = ctx.actor.guestSessionId;
    if (!guestSessionId) {
      throw ApiError.notFound('Guest session not found', 'guest_session');
    }
    const session = await deps.guestSessionRepo.findById(guestSessionId);
    if (!session) {
      throw ApiError.notFound('Guest session not found', 'guest_session');
    }
    // Never return the session key (issued once at creation, §3A.2).
    return {
      id: session.id,
      created_at: session.createdAt,
      last_active_at: session.lastActiveAt,
    };
  });

  // claimQuickSession ─ POST /api/v1/quick-sessions/:id/claim
  registry.register(
    'claimQuickSession',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const userId = ctx.actor.userId!;

      // Dual proof (§3A.3): user auth (above) + guest credential.
      // The auth middleware promotes a user cookie over the guest cookie, so
      // the guest credential is re-read here from the cookie / X-Session-Key
      // header and verified against the session's current guest owner.
      const guestKey =
        ctx.cookies['guest_session'] ?? ctx.headers['x-session-key'];
      if (!guestKey) {
        throw new ApiError(
          403,
          'SESSION_CREDENTIAL_MISMATCH',
          'Guest credential is required to claim a quick session.',
        );
      }
      const guestSession =
        await deps.guestSessionRepo.findBySessionKey(guestKey);
      if (!guestSession) {
        throw new ApiError(
          403,
          'SESSION_CREDENTIAL_MISMATCH',
          'Guest credential is required to claim a quick session.',
        );
      }

      const quickSessionId = ctx.params.id;
      const quickSession = deps.quickSessionRepo.findById(quickSessionId);
      if (!quickSession) {
        throw ApiError.notFound('Quick session not found', 'quick_session');
      }

      // Already claimed by another user → 409, body must not leak the owner.
      if (quickSession.userId) {
        throw ApiError.conflict(
          'QUICK_SESSION_CLAIMED',
          '该快速问诊会话已被其他用户认领。',
          { retryable: false },
        );
      }

      // Credential must match the session's current guest owner.
      if (quickSession.guestSessionId !== guestSession.id) {
        throw new ApiError(
          403,
          'SESSION_CREDENTIAL_MISMATCH',
          'Guest credential does not match this quick session.',
        );
      }

      // Atomic ownership transfer: guest_session_id → null, user_id set, in one
      // statement to satisfy the schema's owner_xor CHECK constraint. On
      // failure the guest session is untouched (no half-bound state, §3A.3).
      const claimed = deps.quickSessionRepo.claim(
        quickSessionId,
        userId,
        guestSession.id,
      );

      return {
        data: {
          quick_session_id: claimed.id,
          user_id: userId,
          origin_guest_session_id: claimed.originGuestSessionId,
          claimed_at: claimed.claimedAt,
          expires_at: claimed.expiresAt,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'user', idempotent: true },
  );
}
