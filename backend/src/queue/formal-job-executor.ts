import type { AppDb } from '../db/client';
import type { AiInvokeResult, AiProvider } from '../ai/provider';
import type { AiJob } from '../db/schema/job';
import { env } from '../config/env';
import {
  FormalGuidanceRuntime,
  formalInputHash,
  modelNameForFormalProvider,
} from '../agent/formal-runtime';
import { FormalMapRepo, parseFormalSnapshot, parseFormalTurnRefs } from '../repo/formal-map-repo';
import { ProjectRepo } from '../repo/project-repo';
import { IntakeRepo } from '../repo/intake-repo';

export class FormalJobExecutor {
  private readonly runtime: FormalGuidanceRuntime;
  private readonly formalMapRepo: FormalMapRepo;
  private readonly projectRepo: ProjectRepo;
  private readonly intakeRepo: IntakeRepo;

  constructor(
    db: AppDb,
    private readonly provider: AiProvider,
  ) {
    this.runtime = new FormalGuidanceRuntime(provider);
    this.formalMapRepo = new FormalMapRepo(db.db);
    this.projectRepo = new ProjectRepo(db.db);
    this.intakeRepo = new IntakeRepo(db.db);
  }

  async process(job: AiJob, payload: unknown): Promise<AiInvokeResult> {
    if (!job.projectId) {
      throw new Error(`Formal job ${job.id} has no project_id`);
    }
    const project = this.projectRepo.findById(job.projectId);
    if (!project) {
      throw new Error(`Formal project not found for job ${job.id}`);
    }
    const latestIntake = this.intakeRepo.findLatest(project.id);
    const turns = this.formalMapRepo.listTurns(project.id).map((turn) => ({
      role: turn.role === 'ai' ? 'assistant' as const : 'user' as const,
      content: turn.content,
      boundRefs: parseFormalTurnRefs(turn),
    }));
    const previous = this.formalMapRepo.findLatestSnapshot(project.id);
    const payloadObj = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const sourceKind = sourceKindFromPayload(payloadObj);
    const modelEnabled = env.AI_PROVIDER !== 'stub';

    const runtime = await this.runtime.run({
      projectId: project.id,
      projectTitle: project.name ?? '正式项目',
      projectDescription: project.description ?? '',
      intakeText: latestIntake?.originalText ?? project.description ?? project.name ?? '',
      turns,
      previousSnapshot: parseFormalSnapshot(previous),
      sourceKind,
      quickBriefSnapshot: payloadObj.quick_brief_snapshot ?? null,
      modelEnabled,
    });

    const persisted = this.formalMapRepo.createSnapshot({
      projectId: project.id,
      status: runtime.providerResult ? 'ready' : 'fallback',
      sourceKind,
      sourceQuickSessionId: typeof payloadObj.source_quick_session_id === 'string' ? payloadObj.source_quick_session_id : null,
      sourceBriefVersionId: typeof payloadObj.source_brief_version_id === 'string' ? payloadObj.source_brief_version_id : null,
      aiJobId: job.id,
      snapshot: runtime.snapshot,
      inputHash: formalInputHash({
        project,
        latestIntake,
        turns,
        payload,
      }),
    });

    this.formalMapRepo.appendAiTurnOnce(
      project.id,
      runtime.snapshot.nextQuestion,
      'question',
    );

    return {
      output: {
        ...runtime.snapshot,
        result_type: 'formal_map_snapshot',
        project_id: project.id,
        map_snapshot_id: persisted.id,
        map_snapshot_version: persisted.version,
        next_question: runtime.snapshot.nextQuestion,
        report_ready: true,
      },
      provider: runtime.providerResult?.provider ?? 'formal-runtime-fallback',
      model: runtime.providerResult?.model ?? modelNameForFormalProvider(),
      promptVersion: 'formal_guidance_output.v1',
      inputTokens: runtime.audit.reduce((sum, audit) => sum + audit.inputTokens, 0),
      outputTokens: runtime.audit.reduce((sum, audit) => sum + audit.outputTokens, 0),
      thinkingMode: runtime.providerResult?.thinkingMode ?? (modelEnabled ? 'unset' : 'disabled'),
      usageEstimated: runtime.audit.some((audit) => audit.usageEstimated),
      skillAudits: runtime.audit,
    };
  }
}

function sourceKindFromPayload(payload: Record<string, unknown>): 'direct' | 'quick_upgrade' | 'conversation_update' {
  if (payload.event === 'formal_message') return 'conversation_update';
  if (payload.source_kind === 'quick_upgrade' || payload.source_quick_session_id) return 'quick_upgrade';
  return 'direct';
}
