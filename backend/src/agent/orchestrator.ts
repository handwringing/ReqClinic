import { createHash } from 'node:crypto';
import type { AiInvokeResult, AiProvider } from '../ai/provider';
import type { AiJob } from '../db/schema/job';
import type { AgentRunRepo } from '../repo/agent-run-repo';
import { resolveAgentPlan } from './agent-plans';
import { defaultSkillRegistry, type SkillRegistry } from './skill-registry';
import type { AgentPlan, SkillManifest } from './types';

export interface StartAgentInvocationInput {
  job: AiJob;
  payload: unknown;
  domainPackVersions?: Record<string, string>;
}

export interface ControlledAgentInvocation {
  readonly plan: AgentPlan;
  invokeProvider(): Promise<AiInvokeResult>;
  succeed(result: AiInvokeResult, output: unknown): void;
  fail(errorCode: string): void;
}

/**
 * Single controlled Orchestrator.
 *
 * This class is intentionally not a free-planning agent. It resolves a fixed
 * AgentPlan for the job, records AgentRun/SkillRun audit rows, and delegates the
 * actual model call to the existing AiProvider. State transitions and writes
 * remain owned by the application services around the worker.
 */
export class ControlledAgentOrchestrator {
  constructor(
    private readonly provider: AiProvider,
    private readonly agentRunRepo: AgentRunRepo,
    private readonly registry: SkillRegistry = defaultSkillRegistry,
  ) {}

  start(input: StartAgentInvocationInput): ControlledAgentInvocation {
    const plan = resolveAgentPlan(
      {
        scopeKind: input.job.scopeKind,
        taskType: input.job.taskType,
      },
      this.registry,
    );
    const agentRun = this.agentRunRepo.createAgentRun({
      aiJobId: input.job.id,
      agentId: plan.agentId,
      planId: plan.planId,
      planVersion: plan.planVersion,
      mode: plan.mode,
      inputHash: input.job.inputHash,
    });

    const skillRuns = plan.steps.map((step, index) => {
      const manifest = this.registry.get(step.skillId, step.skillVersion);
      return {
        manifest,
        run: this.agentRunRepo.createSkillRun({
          agentRunId: agentRun.id,
          stepIndex: index,
          skillId: manifest.skillId,
          skillVersion: manifest.skillVersion,
          category: manifest.category,
          inputHash: input.job.inputHash,
          inputSchemaVersion: manifest.inputSchemaVersion,
          outputSchemaVersion: manifest.outputSchemaVersion,
          promptVersion: manifest.promptVersion,
        }),
      };
    });

    const invokeProvider = () =>
      this.provider.invoke({
        taskType: input.job.taskType,
        payload: input.payload,
        domainPackVersions: input.domainPackVersions,
      });

    return {
      plan,
      invokeProvider,
      succeed: (result: AiInvokeResult, output: unknown) => {
        const outputHash = stableHash(output);
        const skillAudits = new Map(
          (result.skillAudits ?? []).map((audit) => [audit.skillId, audit]),
        );
        for (const { run, manifest } of skillRuns) {
          const audit = skillAudits.get(manifest.skillId);
          this.agentRunRepo.completeSkillRun(run.id, {
            status: 'succeeded',
            outputHash,
            provider: audit?.provider ?? null,
            model: audit?.model ?? modelForSkill(manifest, result),
            thinkingMode: audit?.thinkingMode ?? null,
            inputTokens: audit?.inputTokens ?? null,
            outputTokens: audit?.outputTokens ?? null,
            usageEstimated: audit?.usageEstimated ?? null,
          });
        }
        this.agentRunRepo.completeAgentRun(agentRun.id, 'succeeded', outputHash);
      },
      fail: (errorCode: string) => {
        for (const { run } of skillRuns) {
          this.agentRunRepo.completeSkillRun(run.id, {
            status: 'failed',
            errorCode,
          });
        }
        this.agentRunRepo.completeAgentRun(agentRun.id, 'failed', null);
      },
    };
  }
}

function modelForSkill(manifest: SkillManifest, result: AiInvokeResult): string | null {
  if (manifest.category === 'routing' || manifest.category === 'validation') return null;
  return result.model;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
