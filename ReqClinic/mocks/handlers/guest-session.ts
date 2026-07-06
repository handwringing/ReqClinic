import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';

// 游客会话 Mock：创建、读取、认领快速问诊。

function hashKey(input: string): string {
  // 简单哈希模拟 session_key_hash，避免使用真实加密。
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return `skh_${Math.abs(h).toString(16)}_${input.length}`;
}

export function registerGuestSessionHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register('createGuestSession', async (request: { session_key_hash?: string }) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const session = {
      id: generateUUID(),
      session_key_hash: request?.session_key_hash ?? hashKey(generateUUID()),
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
    store.setGuestSession(session);
    return session;
  });

  registry.register('getCurrentGuestSession', async () => {
    const session = store.getGuestSession();
    if (!session) {
      throw new ApiClientError(401, 'UNAUTHORIZED', '当前没有有效的游客会话', generateUUID());
    }
    return session;
  });

  registry.register(
    'claimQuickSession',
    async (request: { guest_session_id: UUID; quick_session_id: UUID }) => {
      // 本地展示环境直接返回认领结果（无真实用户绑定）。
      return { claimed: true, session_id: request.quick_session_id };
    }
  );
}
