import { describe, expect, it } from 'vitest';

import { StubProvider } from '../src/ai/stub-provider';
import { buildDeterministicFormalSnapshot } from '../src/agent/formal-runtime';
import { JobWorker } from '../src/queue/worker';
import { AgentRunRepo } from '../src/repo/agent-run-repo';
import { AiRunRepo } from '../src/repo/ai-run-repo';
import { FormalMapRepo, parseFormalSnapshot } from '../src/repo/formal-map-repo';
import { IntakeRepo } from '../src/repo/intake-repo';
import { JobRepo } from '../src/repo/job-repo';
import { ProjectRepo } from '../src/repo/project-repo';
import { UserRepo } from '../src/repo/user-repo';
import { createTestDb } from './helpers/test-db';

describe('formal guidance job runtime', () => {
  it('keeps eliciting by map coverage and enters review without a fixed round threshold', () => {
    const baseInput = {
      projectId: 'prj_formal_coverage',
      projectTitle: '园区访客通行优化',
      projectDescription: '梳理访客预约、门岗核验、异常处置和记录追踪。',
      intakeText: '园区访客通行优化，需要明确现场流程、角色权限、异常和风险。',
      turns: [] as Array<{ role: 'assistant' | 'user'; content: string; boundRefs?: unknown[] }>,
      previousSnapshot: null,
      sourceKind: 'direct' as const,
      quickBriefSnapshot: null,
      modelEnabled: false,
    };
    const initial = buildDeterministicFormalSnapshot(baseInput);
    expect(initial.guidanceState.status).toBe('eliciting');
    expect(initial.guidanceState.reportReady).toBe(false);
    expect(initial.nextQuestion).toBeTruthy();

    const turns = initial.modules.flatMap((module, index) => [
      { role: 'assistant' as const, content: module.questions[0] },
      { role: 'user' as const, content: `第 ${index + 1} 个模块的负责人已确认本轮处理口径。` },
    ]);
    const completed = buildDeterministicFormalSnapshot({ ...baseInput, turns });
    expect(completed.guidanceState.status).toBe('review_ready');
    expect(completed.guidanceState.coveredModuleCount).toBe(completed.guidanceState.totalModuleCount);
    expect(completed.guidanceState.unresolvedCount).toBe(0);
    expect(completed.guidanceState.reportReady).toBe(true);
    expect(completed.nextQuestion).toBeNull();
    expect(completed.reportProjection.overview).toContain('进入报告复核');
  });

  it('creates a map snapshot, assistant question, model run, and skill audit chain', async () => {
    const db = createTestDb();
    const userRepo = new UserRepo(db.db);
    const projectRepo = new ProjectRepo(db.db);
    const intakeRepo = new IntakeRepo(db.db);
    const jobRepo = new JobRepo(db.db);
    const aiRunRepo = new AiRunRepo(db.db);
    const agentRunRepo = new AgentRunRepo(db.db);
    const formalMapRepo = new FormalMapRepo(db.db);

    const user = await userRepo.create({
      displayName: 'Formal Owner',
      authSubject: 'auth|formal-owner',
    });
    const project = projectRepo.create({
      ownerId: user.id,
      name: '线下读书会活动策划',
      description: '希望策划一次面向城市白领的线下读书会。',
    });
    intakeRepo.create({
      projectId: project.id,
      originalText: '希望策划一次面向城市白领的线下读书会，要明确活动目标、流程、物料和风险预案。',
      submittedBy: user.id,
    });

    const job = jobRepo.create({
      scopeKind: 'formal_project',
      projectId: project.id,
      taskType: 'formal_guidance',
      payloadJson: JSON.stringify({ event: 'project_created', source_kind: 'direct' }),
      inputHash: 'formal-test-input',
      dedupeKey: 'formal-guidance-golden',
      createdByKind: 'user',
      createdByUserId: user.id,
      maxAttempts: 1,
    });

    const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo, {
      agentRunRepo,
    });
    await worker.processJob(job);

    expect(jobRepo.findById(job.id)?.status).toBe('succeeded');
    const snapshotRow = formalMapRepo.findLatestSnapshot(project.id);
    expect(snapshotRow).not.toBeNull();
    const snapshot = parseFormalSnapshot(snapshotRow);
    expect(snapshot?.result_type).toBe('formal_map_snapshot');
    expect(snapshot?.modules.length).toBeGreaterThanOrEqual(3);
    expect(snapshot?.reportProjection.detailedReport).toContain('正式项目需求分析报告');

    const turns = formalMapRepo.listTurns(project.id);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('ai');
    expect(turns[0].messageType).toBe('question');

    const aiRun = aiRunRepo.findLatestByJob(job.id);
    expect(aiRun?.status).toBe('succeeded');
    expect(aiRun?.thinkingMode).toBe('disabled');

    const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
    expect(agentRuns).toHaveLength(1);
    expect(agentRuns[0].planId).toBe('formal_guidance_report');
    const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
    expect(skillRuns).toHaveLength(7);
    expect(skillRuns.map((run) => run.skillId)).toContain('formal.composition.guidance_report');
  });

  it('keeps direct formal form roles, materials, and constraints visible in the map and report', async () => {
    const db = createTestDb();
    const userRepo = new UserRepo(db.db);
    const projectRepo = new ProjectRepo(db.db);
    const intakeRepo = new IntakeRepo(db.db);
    const jobRepo = new JobRepo(db.db);
    const aiRunRepo = new AiRunRepo(db.db);
    const agentRunRepo = new AgentRunRepo(db.db);
    const formalMapRepo = new FormalMapRepo(db.db);

    const user = await userRepo.create({
      displayName: 'Formal Form Owner',
      authSubject: 'auth|formal-form-owner',
    });
    const project = projectRepo.create({
      ownerId: user.id,
      name: '社区团购志愿者排班工具',
      description: '我要做一个社区团购志愿者排班工具，给社区管理员和志愿者使用。',
    });
    intakeRepo.create({
      projectId: project.id,
      originalText: [
        '我要做一个社区团购志愿者排班工具，给社区管理员和志愿者使用。',
        '相关人员：社区管理员：确认排班规则；志愿者：提交可服务时间；团长：查看当天名单',
        '已有材料：现有微信群报名截图；上月志愿者名单；纸质排班表',
        '约束：两周内出第一版；不做支付；必须适配手机；不收集身份证号',
      ].join('\n'),
      candidateRoles: ['社区管理员：确认排班规则', '志愿者：提交可服务时间', '团长：查看当天名单'],
      candidateConstraints: ['两周内出第一版', '不做支付', '必须适配手机', '不收集身份证号'],
      submittedBy: user.id,
    });

    const job = jobRepo.create({
      scopeKind: 'formal_project',
      projectId: project.id,
      taskType: 'formal_guidance',
      payloadJson: JSON.stringify({ event: 'project_created', source_kind: 'direct' }),
      inputHash: 'formal-form-input',
      dedupeKey: 'formal-form-context',
      createdByKind: 'user',
      createdByUserId: user.id,
      maxAttempts: 1,
    });

    const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo, {
      agentRunRepo,
    });
    await worker.processJob(job);

    const snapshot = parseFormalSnapshot(formalMapRepo.findLatestSnapshot(project.id));
    const mapText = JSON.stringify(snapshot?.modules);
    const reportText = snapshot?.reportProjection.detailedReport ?? '';
    const combined = `${mapText}\n${snapshot?.reportProjection.overview}\n${reportText}`;

    expect(combined).toContain('团长');
    expect(combined).toContain('微信群报名截图');
    expect(combined).toContain('上月志愿者名单');
    expect(combined).toContain('纸质排班表');
    expect(combined).toContain('两周内出第一版');
    expect(combined).toContain('不做支付');
    expect(combined).toContain('适配手机');
    expect(combined).toContain('不收集身份证号');
    expect(reportText).toContain('正式项目需求分析报告');
  });

  it('carries quick brief facts into the formal map as candidates on upgrade', async () => {
    const db = createTestDb();
    const userRepo = new UserRepo(db.db);
    const projectRepo = new ProjectRepo(db.db);
    const intakeRepo = new IntakeRepo(db.db);
    const jobRepo = new JobRepo(db.db);
    const aiRunRepo = new AiRunRepo(db.db);
    const agentRunRepo = new AgentRunRepo(db.db);
    const formalMapRepo = new FormalMapRepo(db.db);

    const user = await userRepo.create({
      displayName: 'Quick Upgrade Owner',
      authSubject: 'auth|quick-upgrade-owner',
    });
    const project = projectRepo.create({
      ownerId: user.id,
      name: '智能海报生成网站',
      description: '输入一句话生成可在线访问的网页海报。',
    });
    intakeRepo.create({
      projectId: project.id,
      originalText: '输入一句话生成可在线访问的网页海报。',
      submittedBy: user.id,
    });

    const quickBriefSnapshot = {
      expected_outcome: '30秒内得到可移动端访问的网页海报',
      target_users: ['团队宣传岗（主要），个人创作者（次要）'],
      core_scenario: '输入一句话后生成网页海报，手机扫码查看',
      scope_included: ['首版只做单页网页海报生成，不做编辑器、团队协作和图片导出'],
      completion_criteria: [
        { description: '从输入完成到海报出来不超过30秒' },
      ],
      unknowns: [
        { question: '智能生成失败时是否需要兜底方案？' },
      ],
      candidate_options: [
        {
          title: '模板结构快速生成',
          description: '优先保证速度、扫码查看和范围可控。',
          cons: ['视觉变化有限'],
          is_recommended: true,
        },
      ],
    };

    const job = jobRepo.create({
      scopeKind: 'formal_project',
      projectId: project.id,
      taskType: 'formal_guidance',
      payloadJson: JSON.stringify({
        event: 'quick_session_upgraded',
        source_kind: 'quick_upgrade',
        source_quick_session_id: 'qs_test_upgrade',
        quick_brief_snapshot: quickBriefSnapshot,
      }),
      inputHash: 'formal-upgrade-input',
      dedupeKey: 'formal-upgrade-golden',
      createdByKind: 'user',
      createdByUserId: user.id,
      maxAttempts: 1,
    });

    const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo, {
      agentRunRepo,
    });
    await worker.processJob(job);

    const snapshot = parseFormalSnapshot(formalMapRepo.findLatestSnapshot(project.id));
    expect(snapshot?.sourceContext).toContain('快速问诊简报升级');
    const mapText = JSON.stringify(snapshot?.modules);
    expect(mapText).toContain('团队宣传岗');
    expect(mapText).toContain('不做编辑器、团队协作和图片导出');
    expect(mapText).toContain('从输入完成到海报出来不超过30秒');
    expect(mapText).toContain('智能生成失败时是否需要兜底方案');
    expect(mapText).toContain('模板结构快速生成');
    expect(snapshot?.qualityNotes).toContain('快速问诊内容已作为候选来源带入，正式项目仍需逐项确认。');
  });
});
