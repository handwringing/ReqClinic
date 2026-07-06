import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';

// Job 轮询 Mock：从 MockTransport 的 jobs Map 读取 Job 状态。

export function registerJobHandlers(registry: MockRouteRegistry, _store: MockSessionStore): void {
  registry.register('getJobStatus', async (request: { job_id: UUID }, _options, transport) => {
    const job = transport.getJob(request.job_id);
    if (!job) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Job 不存在', generateUUID());
    }
    return job;
  });
}
