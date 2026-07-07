import type { ApiTransport } from '@/lib/api/transport';
import type { AiJob, JobStatus } from '@/lib/api/types';
import { MockRouteRegistry } from './registry';

export class MockTransport implements ApiTransport {
  private registry: MockRouteRegistry;
  private jobs: Map<string, AiJob> = new Map();
  private jobTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(registry: MockRouteRegistry) {
    this.registry = registry;
  }

  async request<TReq = unknown, TRes = unknown>(
    operationId: string,
    request?: TReq,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<TRes> {
    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 40));

    const handler = this.registry.get(operationId);
    if (!handler) {
      throw new Error(`Mock handler not registered for operation: ${operationId}`);
    }

    const result = await handler(request, options ?? {}, this);

    if (result && typeof result === 'object' && 'job_id' in result) {
      this.scheduleJobProgression((result as { job_id: string }).job_id);
    }

    return result as TRes;
  }

  private scheduleJobProgression(jobId: string) {
    const job: AiJob = {
      id: jobId,
      status: 'queued',
      result_type: 'next_question',
      progress: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);

    const steps: { delay: number; status: JobStatus; progress: number; step: string }[] = [
      { delay: 60, status: 'running', progress: 40, step: '整理中…' },
      { delay: 140, status: 'validating', progress: 80, step: '同步结果…' },
      { delay: 240, status: 'succeeded', progress: 100, step: '完成' },
    ];

    steps.forEach(({ delay, status, progress, step }) => {
      const timer = setTimeout(() => {
        const j = this.jobs.get(jobId);
        if (j && j.status !== 'cancelled' && j.status !== 'failed') {
          j.status = status;
          j.progress = progress;
          j.current_step = step;
          j.updated_at = new Date().toISOString();
        }
      }, delay);
      this.jobTimers.set(`${jobId}-${delay}`, timer);
    });
  }

  getJob(jobId: string): AiJob | undefined {
    return this.jobs.get(jobId);
  }
}
