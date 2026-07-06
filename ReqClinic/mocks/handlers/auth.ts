import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';

// 未登录状态下的身份认证 Mock。

export function registerAuthHandlers(registry: MockRouteRegistry, _store: MockSessionStore): void {
  registry.register('getAuthSession', async () => {
    return { user_id: null, is_authenticated: false };
  });

  registry.register('logout', async () => {
    return { success: true };
  });

  registry.register('startAccountRecovery', async () => {
    return { recovery_started: true };
  });
}
