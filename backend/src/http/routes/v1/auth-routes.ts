import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import type { UserRepo } from '../../../repo/user-repo';
import type { GuestSessionRepo } from '../../../repo/guest-session-repo';

/**
 * Authentication routes (Task 11, §3C).
 *
 * These three endpoints are the only auth contracts the product frontend
 * depends on: reading the current session, logging out, and starting account
 * recovery. Real login / registration / OAuth flows are owned by an external
 * identity module; here we only clear the `auth_session` cookie and surface a
 * stable, non-leaking recovery-accepted response.
 */
export interface AuthRouteDeps {
  userRepo: UserRepo;
  guestSessionRepo: GuestSessionRepo;
}

export function registerAuthRoutes(
  registry: RouteRegistry,
  deps: AuthRouteDeps,
): void {
  // getAuthSession ─ GET /api/v1/auth/session
  registry.register('getAuthSession', async (ctx: RouteContext) => {
    const actor = ctx.actor;
    if (actor.kind !== 'user' || !actor.userId) {
      // Unauthenticated → null data (§3C.1: authenticated=false, no 401).
      return { data: null, meta: {} };
    }
    const user = await deps.userRepo.findById(actor.userId);
    if (!user) {
      return { data: null, meta: {} };
    }
    return {
      authenticated: true,
      user: {
        id: user.id,
        display_name: user.displayName,
        email: user.email,
      },
      capabilities: [],
    };
  });

  // logout ─ POST /api/v1/auth/logout
  registry.register('logout', async (ctx: RouteContext) => {
    // Clear the auth session cookie only; leave the guest cookie intact so
    // unbound guest data remains accessible (§3C.2).
    ctx.reply?.clearCookie('auth_session', { path: '/' });
    // §AuthLogoutResponse: 200 with { data: { logged_out: true }, meta }.
    return { data: { logged_out: true }, meta: {}, statusCode: 200 };
  });

  // startAccountRecovery ─ POST /api/v1/auth/recovery/start
  registry.register('startAccountRecovery', async (ctx: RouteContext) => {
    const body = ctx.body ?? {};
    const accountHint = body.account_hint;
    if (typeof accountHint !== 'string' || accountHint.length === 0) {
      throw ApiError.validationError({
        account_hint: 'must be a non-empty string',
      });
    }
    if (accountHint.length > 320) {
      throw ApiError.validationError({
        account_hint: 'must be at most 320 characters',
      });
    }
    // Simulated dispatch — never leak whether the account exists (§3C.3).
    // Real delivery (email / SMS / passkey) is wired by the identity module.
    return {
      data: {
        accepted: true,
        message: '如果账户存在，恢复指引将发送到已绑定的验证方式。',
      },
      meta: {},
      statusCode: 202,
    };
  });
}
