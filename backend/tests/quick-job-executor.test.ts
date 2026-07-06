import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { StubProvider } from '../src/ai/stub-provider';
import { JobWorker } from '../src/queue/worker';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { QuickSessionRepo } from '../src/repo/quick-session-repo';
import { QuickTurnRepo } from '../src/repo/quick-turn-repo';
import { BriefRepo } from '../src/repo/brief-repo';
import { JobRepo } from '../src/repo/job-repo';
import { AiRunRepo } from '../src/repo/ai-run-repo';
import { AgentRunRepo } from '../src/repo/agent-run-repo';
import { env } from '../src/config/env';
import type { AiInvokeInput, AiInvokeResult, AiProvider } from '../src/ai/provider';

describe('quick job executor', () => {
  it('runs a quick next-question job through runtime, persistence, and audit', async () => {
    const db = createTestDb();
    const guestRepo = new GuestSessionRepo(db.db, 'test-pepper');
    const quickSessionRepo = new QuickSessionRepo(db.db);
    const quickTurnRepo = new QuickTurnRepo(db.db);
    const jobRepo = new JobRepo(db.db);
    const aiRunRepo = new AiRunRepo(db.db);
    const agentRunRepo = new AgentRunRepo(db.db);

    const guest = await guestRepo.create();
    const session = quickSessionRepo.create({
      actorKind: 'guest',
      guestSessionId: guest.id,
      sourceKind: 'sample',
      originalIdea: '我想做一个智能海报生成网站，用户输入一句话就能生成可在线访问的海报网页。',
    });
    quickTurnRepo.create({
      quickSessionId: session.id,
      role: 'user',
      content: session.originalInput,
      messageType: 'answer',
    });

    const payloadJson = JSON.stringify({
      event: 'session_created',
      quick_session_id: session.id,
    });
    const inputHash = createHash('sha256').update(payloadJson).digest('hex');
    const job = jobRepo.create({
      scopeKind: 'quick_session',
      quickSessionId: session.id,
      taskType: 'next_question',
      payloadJson,
      inputHash,
      dedupeKey: inputHash.slice(0, 16),
      createdByKind: 'guest',
      createdByGuestSessionId: guest.id,
    });

    const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo, {
      agentRunRepo,
    });
    await worker.processJob(job);

    const finalJob = jobRepo.findById(job.id);
    expect(finalJob?.status).toBe('succeeded');

    const updatedSession = quickSessionRepo.findById(session.id);
    expect(updatedSession?.status).toBe('clarifying');
    const snapshot = JSON.parse(updatedSession!.coverageSlotsJson);
    expect(snapshot.understanding.summary).toContain('网页海报');
    expect(snapshot.slots.map((slot: any) => slot.slot_id)).toContain('target_user');

    const turns = quickTurnRepo.listBySession(session.id, { limit: 10 }).items;
    expect(turns.some((turn) => turn.role === 'ai' && turn.questionId)).toBe(true);

    const run = aiRunRepo.findLatestByJob(job.id);
    expect(run?.status).toBe('succeeded');
    expect(JSON.parse(run!.parsedOutputJson!).result_type).toBe('next_question');

    const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
    expect(agentRuns).toHaveLength(1);
    expect(agentRuns[0].planId).toBe('quick_consult');
    expect(agentRunRepo.findSkillRunsByAgent(agentRuns[0].id)).toHaveLength(6);
  });

  it('records quick skill token and thinking audit when model skills run', async () => {
    const originalProvider = env.AI_PROVIDER;
    const originalModel = env.OLLAMA_MODEL;
    env.AI_PROVIDER = 'ollama';
    env.OLLAMA_MODEL = 'audit-test-model';
    try {
      const db = createTestDb();
      const guestRepo = new GuestSessionRepo(db.db, 'test-pepper');
      const quickSessionRepo = new QuickSessionRepo(db.db);
      const quickTurnRepo = new QuickTurnRepo(db.db);
      const jobRepo = new JobRepo(db.db);
      const aiRunRepo = new AiRunRepo(db.db);
      const agentRunRepo = new AgentRunRepo(db.db);
      const provider = new AuditProvider();

      const guest = await guestRepo.create();
      const session = quickSessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guest.id,
        sourceKind: 'custom',
        originalIdea: '我想做一个智能海报生成网站。',
      });
      quickTurnRepo.create({
        quickSessionId: session.id,
        role: 'user',
        content: session.originalInput,
        messageType: 'answer',
      });
      for (const content of [
        '主要给团队宣传岗使用。',
        '输入一句话后生成网页海报，手机扫码查看。',
        '首版只做单页网页海报生成。',
        '完成标准是从输入完成到海报出来不超过30秒。',
      ]) {
        quickTurnRepo.create({
          quickSessionId: session.id,
          role: 'user',
          content,
          messageType: 'answer',
        });
      }

      const payloadJson = JSON.stringify({
        event: 'answer_submitted',
        quick_session_id: session.id,
      });
      const inputHash = createHash('sha256').update(payloadJson).digest('hex');
      const job = jobRepo.create({
        scopeKind: 'quick_session',
        quickSessionId: session.id,
        taskType: 'next_question',
        payloadJson,
        inputHash,
        dedupeKey: inputHash.slice(0, 16),
        createdByKind: 'guest',
        createdByGuestSessionId: guest.id,
      });

      const worker = new JobWorker(db, provider, aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      const run = aiRunRepo.findLatestByJob(job.id);
      expect(run?.status).toBe('succeeded');
      expect(run?.inputTokens).toBe(90);
      expect(run?.outputTokens).toBe(45);
      expect(run?.thinkingMode).toBe('enabled');

      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
      const structuring = skillRuns.find((item) => item.skillId === 'quick.structuring.understanding_patch');
      const composition = skillRuns.find((item) => item.skillId === 'quick.composition.brief_views');
      const validation = skillRuns.find((item) => item.skillId === 'quick.validation.coverage_gate');
      expect(structuring?.provider).toBe('audit-provider');
      expect(structuring?.inputTokens).toBe(10);
      expect(structuring?.outputTokens).toBe(5);
      expect(composition?.thinkingMode).toBe('enabled');
      expect(validation?.inputTokens).toBe(0);
      expect(validation?.model).toBeNull();
    } finally {
      env.AI_PROVIDER = originalProvider;
      env.OLLAMA_MODEL = originalModel;
    }
  });

  it('keeps sample sessions on the local runtime even when a cloud model is configured', async () => {
    const originalProvider = env.AI_PROVIDER;
    const originalModel = env.OLLAMA_MODEL;
    env.AI_PROVIDER = 'ollama';
    env.OLLAMA_MODEL = 'sample-should-not-call-model';
    try {
      const db = createTestDb();
      const guestRepo = new GuestSessionRepo(db.db, 'test-pepper');
      const quickSessionRepo = new QuickSessionRepo(db.db);
      const quickTurnRepo = new QuickTurnRepo(db.db);
      const jobRepo = new JobRepo(db.db);
      const aiRunRepo = new AiRunRepo(db.db);
      const agentRunRepo = new AgentRunRepo(db.db);
      const provider = new CountingProvider();

      const guest = await guestRepo.create();
      const session = quickSessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guest.id,
        sourceKind: 'sample',
        sourceCaseId: 'ai-poster-website',
        originalIdea: '我想做一个智能海报生成网站，用户输入一句话就能生成可在线访问的海报网页。',
      });
      quickTurnRepo.create({
        quickSessionId: session.id,
        role: 'user',
        content: session.originalInput,
        messageType: 'answer',
      });

      const payloadJson = JSON.stringify({
        event: 'session_created',
        quick_session_id: session.id,
      });
      const inputHash = createHash('sha256').update(payloadJson).digest('hex');
      const job = jobRepo.create({
        scopeKind: 'quick_session',
        quickSessionId: session.id,
        taskType: 'next_question',
        payloadJson,
        inputHash,
        dedupeKey: inputHash.slice(0, 16),
        createdByKind: 'guest',
        createdByGuestSessionId: guest.id,
      });

      const worker = new JobWorker(db, provider, aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      expect(provider.calls).toBe(0);
      const run = aiRunRepo.findLatestByJob(job.id);
      expect(run?.provider).toBe('quick-runtime-fallback');
      expect(run?.model).toBe('quick-runtime-fallback');
      expect(run?.inputTokens).toBe(0);
      expect(run?.outputTokens).toBe(0);

      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
      expect(skillRuns.every((item) => item.inputTokens === 0 && item.outputTokens === 0)).toBe(true);
    } finally {
      env.AI_PROVIDER = originalProvider;
      env.OLLAMA_MODEL = originalModel;
    }
  });

  it('keeps option comparison separate from brief generation', async () => {
    const db = createTestDb();
    const guestRepo = new GuestSessionRepo(db.db, 'test-pepper');
    const quickSessionRepo = new QuickSessionRepo(db.db);
    const quickTurnRepo = new QuickTurnRepo(db.db);
    const briefRepo = new BriefRepo(db.db);
    const jobRepo = new JobRepo(db.db);
    const aiRunRepo = new AiRunRepo(db.db);
    const agentRunRepo = new AgentRunRepo(db.db);

    const guest = await guestRepo.create();
    const session = quickSessionRepo.create({
      actorKind: 'guest',
      guestSessionId: guest.id,
      sourceKind: 'sample',
      sourceCaseId: 'ai-poster-website',
      originalIdea: '我想做一个智能海报生成网站，用户输入一句话就能生成可在线访问的海报网页。',
    });
    quickSessionRepo.updateStatus(session.id, 'clarifying');
    quickSessionRepo.updateStatus(session.id, 'understanding_review');
    quickSessionRepo.updateStatus(session.id, 'option_review');

    for (const content of [
      session.originalInput,
      '网页海报，不是图片文件。',
      '主要给团队宣传岗使用。',
      '30秒指从输入完成到海报出来。',
      '不做多人协作编辑或二次修改。',
      '【制作范围】首版只做单页网页海报生成，不做编辑器、团队协作和图片导出。',
    ]) {
      quickTurnRepo.create({
        quickSessionId: session.id,
        role: 'user',
        content,
        messageType: 'answer',
      });
    }

    const payloadJson = JSON.stringify({
      event: 'option_preference',
      quick_session_id: session.id,
      option_id: 'apw_option_static_page',
    });
    const inputHash = createHash('sha256').update(payloadJson).digest('hex');
    const job = jobRepo.create({
      scopeKind: 'quick_session',
      quickSessionId: session.id,
      taskType: 'option_comparison',
      payloadJson,
      inputHash,
      dedupeKey: inputHash.slice(0, 16),
      createdByKind: 'guest',
      createdByGuestSessionId: guest.id,
    });

    const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo, {
      agentRunRepo,
    });
    await worker.processJob(job);

    const updatedSession = quickSessionRepo.findById(session.id);
    expect(updatedSession?.status).toBe('option_review');
    expect(briefRepo.listVersions(session.id, { limit: 10 }).items).toHaveLength(0);

    const run = aiRunRepo.findLatestByJob(job.id);
    expect(JSON.parse(run!.parsedOutputJson!).result_type).toBe('option_comparison');
  });
});

class AuditProvider implements AiProvider {
  async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
    const tokenMap: Record<string, [number, number]> = {
      'quick.structuring.understanding_patch': [10, 5],
      'quick.decisioning.options': [30, 15],
      'quick.composition.brief_views': [50, 25],
    };
    const [inputTokens, outputTokens] = tokenMap[input.taskType] ?? [1, 1];
    return {
      output: outputForTask(input.taskType),
      provider: 'audit-provider',
      model: 'audit-model',
      promptVersion: 'audit-prompt',
      inputTokens,
      outputTokens,
      thinkingMode: input.taskType === 'quick.composition.brief_views' ? 'enabled' : 'disabled',
      usageEstimated: false,
    };
  }
}

class CountingProvider implements AiProvider {
  calls = 0;

  async invoke(): Promise<AiInvokeResult> {
    this.calls += 1;
    throw new Error('sample sessions must not call the model provider');
  }
}

function outputForTask(taskType: string): unknown {
  if (taskType === 'quick.structuring.understanding_patch') {
    return {
      understanding: {
        summary: '为团队宣传岗生成可扫码查看的网页海报。',
        slots: {
          expected_outcome: { value: '生成可在线访问的网页海报', status: 'partial', source: 'user' },
          target_user: { value: '团队宣传岗', status: 'partial', source: 'user' },
          core_scenario: { value: '输入一句话后生成网页海报，手机扫码查看', status: 'partial', source: 'user' },
          scope_boundary: { value: '首版只做单页网页海报生成', status: 'partial', source: 'user' },
          completion_criteria: { value: '从输入完成到海报出来不超过30秒', status: 'partial', source: 'user' },
          constraints_risks: { value: null, status: 'missing', source: 'system_default' },
        },
      },
      changedSlots: ['expected_outcome', 'target_user', 'core_scenario', 'scope_boundary', 'completion_criteria'],
    };
  }
  if (taskType === 'quick.decisioning.options') {
    return {
      options: [
        {
          id: 'option_focused_v1',
          title: '先做聚焦版',
          description: '先围绕单页网页海报生成验证核心场景。',
          pros: ['范围清楚'],
          cons: ['扩展能力后续再评估'],
          isRecommended: true,
        },
        {
          id: 'option_expanded_v1',
          title: '一次扩大范围',
          description: '把尚未确认的扩展内容也纳入首版。',
          pros: ['覆盖更多想法'],
          cons: ['更容易返工'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先做聚焦版。',
    };
  }
  return {
    views: {
      simple: `# 需求简报（概述）\n${'当前理解清楚，建议先验证核心场景。'.repeat(40)}`,
      exec: `# 需求分析详细报告\n## 报告摘要\n## 目标与背景\n## 参与对象\n## 核心场景\n## 范围边界\n## 完成标准\n## 风险与待确认事项\n## 后续动作\n${'详细报告内容。'.repeat(260)}`,
    },
  };
}
