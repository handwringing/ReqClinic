import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { agentRuns, skillRuns, type AgentRun, type SkillRun } from '../db/schema/job';
import type { AgentMode, SkillCategory } from '../agent/types';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export interface CreateAgentRunInput {
  aiJobId: string;
  agentId: string;
  planId: string;
  planVersion: string;
  mode: AgentMode;
  inputHash: string;
}

export interface CreateSkillRunInput {
  agentRunId: string;
  stepIndex: number;
  skillId: string;
  skillVersion: string;
  category: SkillCategory;
  inputHash: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  promptVersion: string;
}

export interface CompleteSkillRunInput {
  status: 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  outputHash?: string | null;
  provider?: string | null;
  model?: string | null;
  thinkingMode?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  usageEstimated?: boolean | null;
  errorCode?: string | null;
}

export class AgentRunRepo {
  constructor(private db: DrizzleDB) {}

  createAgentRun(input: CreateAgentRunInput): AgentRun {
    const ts = now();
    return this.db
      .insert(agentRuns)
      .values({
        id: generateId('arn'),
        aiJobId: input.aiJobId,
        agentId: input.agentId,
        planId: input.planId,
        planVersion: input.planVersion,
        mode: input.mode,
        status: 'running',
        inputHash: input.inputHash,
        startedAt: ts,
      })
      .returning()
      .get();
  }

  completeAgentRun(
    id: string,
    status: 'succeeded' | 'failed' | 'cancelled',
    outputHash?: string | null,
  ): AgentRun {
    return this.db
      .update(agentRuns)
      .set({
        status,
        outputHash: outputHash ?? null,
        completedAt: now(),
      })
      .where(eq(agentRuns.id, id))
      .returning()
      .get();
  }

  createSkillRun(input: CreateSkillRunInput): SkillRun {
    const ts = now();
    return this.db
      .insert(skillRuns)
      .values({
        id: generateId('srn'),
        agentRunId: input.agentRunId,
        stepIndex: input.stepIndex,
        skillId: input.skillId,
        skillVersion: input.skillVersion,
        category: input.category,
        status: 'running',
        inputHash: input.inputHash,
        inputSchemaVersion: input.inputSchemaVersion,
        outputSchemaVersion: input.outputSchemaVersion,
        promptVersion: input.promptVersion,
        startedAt: ts,
      })
      .returning()
      .get();
  }

  completeSkillRun(id: string, input: CompleteSkillRunInput): SkillRun {
    return this.db
      .update(skillRuns)
      .set({
        status: input.status,
        outputHash: input.outputHash ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        thinkingMode: input.thinkingMode ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        usageEstimated:
          input.usageEstimated === undefined || input.usageEstimated === null
            ? null
            : input.usageEstimated
              ? 1
              : 0,
        errorCode: input.errorCode ?? null,
        completedAt: now(),
      })
      .where(eq(skillRuns.id, id))
      .returning()
      .get();
  }

  findAgentRunsByJob(aiJobId: string): AgentRun[] {
    return this.db.select().from(agentRuns).where(eq(agentRuns.aiJobId, aiJobId)).all();
  }

  findSkillRunsByAgent(agentRunId: string): SkillRun[] {
    return this.db.select().from(skillRuns).where(eq(skillRuns.agentRunId, agentRunId)).all();
  }
}
