import { z } from 'zod';
import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireProjectCapability } from '../../middleware/auth';
import { resolveFormalUserId, formalUserActor } from '../../formal-actor';
import { enqueueFormalGuidanceJob } from '../../formal-job';
import type { UserRepo } from '../../../repo/user-repo';
import type { AgreementRepo } from '../../../repo/agreement-repo';
import type { JobRepo } from '../../../repo/job-repo';
import type { ProjectRepo } from '../../../repo/project-repo';
import {
  FormalMapRepo,
  parseFormalSnapshot,
  parseFormalTurnRefs,
} from '../../../repo/formal-map-repo';

export interface FormalRouteDeps {
  userRepo: UserRepo;
  agreementRepo: AgreementRepo;
  projectRepo: ProjectRepo;
  formalMapRepo: FormalMapRepo;
  jobRepo: JobRepo;
}

const formalMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  bound_refs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string().optional(),
      kind: z.string().optional(),
    }).passthrough(),
  ).default([]),
});

export function registerFormalRoutes(
  registry: RouteRegistry,
  deps: FormalRouteDeps,
): void {
  registry.register('getFormalMapSnapshot', async (ctx: RouteContext) => {
    const userId = await resolveFormalUserId(ctx, { userRepo: deps.userRepo });
    await requireProjectCapability(formalUserActor(userId), ctx.db.db, ctx.params.id, 'read');
    const project = deps.projectRepo.findById(ctx.params.id);
    if (!project) throw ApiError.notFound('Project not found', 'project');

    return serializeFormalMap(ctx, deps);
  });

  registry.register(
    'postFormalProjectMessage',
    async (ctx: RouteContext) => {
      const userId = await resolveFormalUserId(ctx, {
        userRepo: deps.userRepo,
        agreementRepo: deps.agreementRepo,
      });
      await requireProjectCapability(formalUserActor(userId), ctx.db.db, ctx.params.id, 'edit');
      const project = deps.projectRepo.findById(ctx.params.id);
      if (!project) throw ApiError.notFound('Project not found', 'project');

      const body = formalMessageSchema.parse(ctx.body ?? {});
      deps.formalMapRepo.createTurn({
        projectId: project.id,
        role: 'user',
        content: body.content.trim(),
        messageType: 'answer',
        boundRefs: body.bound_refs,
      });
      const job = enqueueFormalGuidanceJob({
        ctx,
        jobRepo: deps.jobRepo,
        projectId: project.id,
        userId,
        payload: {
          event: 'formal_message',
          content: body.content.trim(),
          bound_refs: body.bound_refs,
        },
      });

      return {
        data: job,
        meta: {},
        statusCode: 202,
      };
    },
    { requireActor: 'any', requireAgreement: true, idempotent: true },
  );
}

function serializeFormalMap(ctx: RouteContext, deps: FormalRouteDeps) {
  const latest = deps.formalMapRepo.findLatestSnapshot(ctx.params.id);
  const activeJob = deps.jobRepo.findLatestActiveForProject(ctx.params.id);
  const messages = deps.formalMapRepo.listTurns(ctx.params.id).map((turn) => ({
    id: turn.id,
    project_id: turn.projectId,
    role: turn.role === 'ai' ? 'assistant' : 'user',
    content: turn.content,
    message_type: turn.messageType,
    bound_refs: parseFormalTurnRefs(turn),
    created_at: turn.createdAt,
  }));
  return {
    project_id: ctx.params.id,
    active_job_id: activeJob?.id ?? null,
    snapshot: latest
      ? {
          id: latest.id,
          project_id: latest.projectId,
          version: latest.version,
          status: latest.status,
          source_kind: latest.sourceKind,
          created_at: latest.createdAt,
          data: parseFormalSnapshot(latest),
        }
      : null,
    messages,
  };
}
