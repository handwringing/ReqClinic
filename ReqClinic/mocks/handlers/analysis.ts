import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID, Outcome, AiJob, PaginatedResponse } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { asterFixture } from './_fixtures';

// 分析与作业 Mock：创建分析运行（异步）、取消作业、列出结果。

export function registerAnalysisHandlers(
  registry: MockRouteRegistry,
  _store: MockSessionStore
): void {
  registry.register('createAnalysisRun', async () => {
    return { job_id: generateUUID(), status: 'accepted' as const };
  });

  registry.register('cancelJob', async (request: { job_id: UUID }, _options, transport) => {
    const job = transport.getJob(request.job_id);
    if (!job) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Job 不存在', generateUUID());
    }
    job.status = 'cancelled';
    job.updated_at = new Date().toISOString();
    return job as AiJob;
  });

  registry.register(
    'listOutcomes',
    async (request: { project_id: UUID; limit?: number; offset?: number }) => {
      const fx = asterFixture();
      const fxOutcomes: any[] = fx?.outcomes ?? [];
      const items: Outcome[] = fxOutcomes.map(
        (o: any): Outcome => ({
          id: o.id ?? generateUUID(),
          project_id: request.project_id,
          code: o.code ?? 'O-1',
          title: o.title ?? '成果',
          description: o.description ?? '',
          status: o.status ?? 'confirmed',
          version: o.version ?? 1,
          owner_id: o.owner_id,
          evidence_refs: o.evidence_refs ?? [],
        })
      );
      const limit = request.limit ?? 50;
      const offset = request.offset ?? 0;
      const paged = items.slice(offset, offset + limit);
      return { items: paged, total: items.length, limit, offset } as PaginatedResponse<Outcome>;
    }
  );
}
