import { createHash } from 'node:crypto';
import type { RouteContext } from './route-registry';
import type { JobRepo } from '../repo/job-repo';

export interface EnqueueFormalGuidanceJobInput {
  ctx: RouteContext;
  jobRepo: JobRepo;
  projectId: string;
  userId: string;
  payload: Record<string, unknown>;
}

export function enqueueFormalGuidanceJob(input: EnqueueFormalGuidanceJobInput): {
  job_id: string;
  status: string;
  status_url: string;
} {
  const payloadJson = JSON.stringify({
    ...input.payload,
    project_id: input.projectId,
    request_id: input.ctx.requestId,
  });
  const inputHash = createHash('sha256').update(payloadJson, 'utf8').digest('hex');
  const job = input.jobRepo.create({
    scopeKind: 'formal_project',
    projectId: input.projectId,
    taskType: 'formal_guidance',
    payloadJson,
    inputHash,
    dedupeKey: inputHash.slice(0, 16),
    createdByKind: 'user',
    createdByUserId: input.userId,
  });
  return {
    job_id: job.id,
    status: job.status,
    status_url: `/api/v1/ai-jobs/${job.id}`,
  };
}
