import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_PLANS, QUICK_CONSULT_PLAN, resolveAgentPlan } from '../src/agent/agent-plans';
import { defaultSkillRegistry } from '../src/agent/skill-registry';
import { SKILL_CATEGORIES } from '../src/agent/types';
import { QuickConsultRuntime } from '../src/agent/quick-runtime';
import type { QuickTurn } from '../src/agent/quick-schemas';
import type { AiInvokeInput, AiInvokeResult, AiProvider } from '../src/ai/provider';

describe('controlled agent + skill runtime', () => {
  it('resolves quick AI task types to the quick consult plan', () => {
    const plan = resolveAgentPlan({
      scopeKind: 'quick_session',
      taskType: 'brief_generation',
      state: 'option_review',
    });

    expect(plan.planId).toBe('quick_consult');
    expect(plan.planVersion).toBe('1.0.0');
    expect(plan.steps).toHaveLength(6);
  });

  it('keeps quick skill categories in the intended Orchestrator order', () => {
    const categories = QUICK_CONSULT_PLAN.steps.map((step) =>
      defaultSkillRegistry.get(step.skillId, step.skillVersion).category,
    );

    expect(categories).toEqual([
      'routing',
      'structuring',
      'validation',
      'elicitation',
      'decisioning',
      'composition',
    ]);
  });

  it('all registered plans reference existing versioned skill manifests', () => {
    for (const plan of AGENT_PLANS) {
      for (const step of plan.steps) {
        const manifest = defaultSkillRegistry.get(step.skillId, step.skillVersion);
        expect(manifest.skillId).toBe(step.skillId);
        expect(manifest.skillVersion).toBe(step.skillVersion);
        expect(SKILL_CATEGORIES).toContain(manifest.category);
        expect(manifest.inputSchemaVersion.length).toBeGreaterThan(0);
        expect(manifest.outputSchemaVersion.length).toBeGreaterThan(0);
        expect(manifest.promptVersion.length).toBeGreaterThan(0);
        // Quick/formal skills use the '*.vN' schema-version convention and
        // require at least one validator; training skills use semver-style
        // versions and may have no model-side validators (deterministic).
        if (plan.mode !== 'training') {
          expect(manifest.inputSchemaVersion).toMatch(/\.v\d+$/);
          expect(manifest.outputSchemaVersion).toMatch(/\.v\d+$/);
          expect(manifest.validators.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('quick skills keep general DomainPack fallback and do not depend on ad-hoc schemas', () => {
    for (const step of QUICK_CONSULT_PLAN.steps) {
      const manifest = defaultSkillRegistry.get(step.skillId, step.skillVersion);
      expect(manifest.requiredDomainPacks).toContain('general');
      expect(manifest.validators).toContain('schema');
    }
  });

  it('runs the quick consult skill flow and asks the highest-value next question', async () => {
    const runtime = new QuickConsultRuntime();
    const result = await runtime.run({
      originalInput: '我想做一个智能海报生成网站，用户输入一句话就能生成可在线访问的海报网页，30秒内能出结果。',
    });

    expect(result.routing.domainPackId).toBe('software-delivery');
    expect(result.validation.canEnterReview).toBe(false);
    expect(result.elicitation.slot).toBe(result.validation.nextQuestionSlot);
    expect(result.elicitation.question).toBeTruthy();
    expect(result.validation.qualityIssues.length).toBeGreaterThan(0);
    expect(result.composition.views.simple).toContain('现在可以这样理解');
    expect(result.composition.views.exec).toContain('需求质量检查');
  });

  it('does not skip clarification when the first message says the details are unclear', async () => {
    const originalInput =
      '我想办一个面向大学新生的线下读书分享会，但现在只知道想提高大家对经典阅读的兴趣，具体流程和完成标准还没想清楚。';
    const runtime = new QuickConsultRuntime();
    const result = await runtime.run({
      originalInput,
      turns: [{ role: 'user', content: originalInput }],
    });

    expect(result.validation.canEnterReview).toBe(false);
    expect(result.elicitation.question).toBeTruthy();
    expect(result.validation.unknowns.map((item) => item.slot)).toContain('core_scenario');
    expect(result.validation.unknowns.map((item) => item.slot)).toContain('completion_criteria');
  });

  it('does not let model validation bypass deterministic required-slot gates', async () => {
    const provider: AiProvider = {
      async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
        if (input.taskType === 'quick.validation.coverage_gate') {
          return {
            provider: 'test',
            model: 'test',
            promptVersion: 'test',
            inputTokens: 1,
            outputTokens: 1,
            output: {
              canEnterReview: true,
              nextQuestionSlot: null,
              unknowns: [],
              qualityIssues: [],
            },
          };
        }
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {},
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会，完成标准还没想清楚。',
      turns: [
        { role: 'user', content: '主要面向大一新生。' },
        { role: 'user', content: '开学第3周周五晚上在图书馆报告厅做90分钟。' },
        { role: 'user', content: '本次只做活动宣传报名、现场导读、分组讨论和结束反馈，不做长期社群运营。' },
      ],
      modelEnabled: true,
      modelSkillIds: ['quick.validation.coverage_gate'],
    });

    expect(result.validation.canEnterReview).toBe(false);
    expect(result.validation.unknowns.map((item) => item.slot)).toContain('completion_criteria');
    expect(result.elicitation.question).toBeTruthy();
  });

  it('keeps numeric completion facts when model structuring drops them', async () => {
    const provider: AiProvider = {
      async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {
            understanding: {
              summary: '生成网页海报',
              slots: {
                expected_outcome: { value: '生成网页海报', status: 'partial', source: 'user' },
                target_user: { value: '团队宣传岗', status: 'partial', source: 'user' },
                core_scenario: { value: '输入一句话生成网页海报', status: 'partial', source: 'user' },
                scope_boundary: { value: '只做单页网页海报', status: 'partial', source: 'user' },
                completion_criteria: { value: '生成速度要快', status: 'partial', source: 'user' },
                constraints_risks: { value: null, status: 'missing', source: 'system_default' },
              },
            },
            changedSlots: ['expected_outcome', 'target_user', 'core_scenario', 'scope_boundary', 'completion_criteria'],
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想做一个智能海报生成网站，验收还没想清楚。',
      turns: [
        {
          role: 'user',
          content:
            '主要给团队宣传岗使用。完成标准是从提交文字到海报生成不超过30秒，移动端能正常打开，首批内部试用10个人里至少7个人愿意继续用。',
        },
      ],
      modelEnabled: true,
      modelSkillIds: ['quick.structuring.understanding_patch'],
    });

    expect(result.structuring.understanding.slots.completion_criteria.value).toContain('30秒');
    expect(result.structuring.understanding.slots.completion_criteria.value).toContain('10个人');
    expect(result.structuring.understanding.slots.completion_criteria.value).toContain('7个人');
  });

  it('rejects unconfirmed exclusions in model-generated scope slots', async () => {
    const provider: AiProvider = {
      async invoke(): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {
            understanding: {
              summary: '办一场新生读书分享会',
              slots: {
                expected_outcome: { value: '让大学新生愿意来参加读书分享会', status: 'partial', source: 'user' },
                target_user: { value: '大学新生', status: 'partial', source: 'user' },
                core_scenario: { value: '线下读书分享会', status: 'partial', source: 'user' },
                scope_boundary: {
                  value: '本次只做一场线下读书分享会，不包含线上直播、多场次或后续系列活动',
                  status: 'partial',
                  source: 'assistant_inferred',
                },
                completion_criteria: {
                  value: '计划覆盖60名新生，目标至少40人实际到场',
                  status: 'partial',
                  source: 'user',
                },
                constraints_risks: { value: null, status: 'missing', source: 'system_default' },
              },
            },
            changedSlots: ['expected_outcome', 'target_user', 'core_scenario', 'scope_boundary', 'completion_criteria'],
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会，但现在只知道大概想让大家愿意来参加。',
      turns: [
        {
          role: 'user',
          content: '计划先覆盖60名新生，目标至少40人实际到场；时间是开学第3周周五晚上，地点是图书馆报告厅，活动约90分钟。',
        },
      ],
      modelEnabled: true,
      modelSkillIds: ['quick.structuring.understanding_patch'],
    });

    const scope = result.structuring.understanding.slots.scope_boundary.value ?? '';
    expect(scope).not.toContain('线上直播');
    expect(scope).not.toContain('多场次');
    expect(scope).not.toContain('后续系列');
    expect(scope).toBe('');
    expect(result.validation.canEnterReview).toBe(false);
    expect(result.validation.unknowns.map((item) => item.slot)).toContain('scope_boundary');
  });

  it('rejects candidate options that violate confirmed scope exclusions', async () => {
    const provider: AiProvider = {
      async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
        if (input.taskType === 'quick.decisioning.options') {
          return {
            provider: 'test',
            model: 'test',
            promptVersion: 'test',
            inputTokens: 1,
            outputTokens: 1,
            output: {
              options: [
                {
                  id: 'bad_hybrid',
                  title: '线上线下混合读书分享会',
                  description: '增加线上直播，并建立临时社群用于活动前后互动。',
                  pros: ['扩大参与面'],
                  cons: ['需要额外技术支持'],
                  isRecommended: true,
                },
              ],
              recommendation: '推荐增加线上直播和社群互动。',
            },
          };
        }
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {},
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会。',
      turns: [
        {
          role: 'user',
          content: '第一版只做活动宣传报名、现场签到、开场导读、分组讨论和结束反馈收集，不做长期社群运营、线上直播和付费课程。',
        },
        {
          role: 'user',
          content: '计划覆盖60名新生，实际到场不少于40人，平均满意度达到4分以上。',
        },
      ],
      forceDecisioning: true,
      modelEnabled: true,
      modelSkillIds: ['quick.decisioning.options'],
    });

    expect(result.decisioning.options[0].id).toBe('option_structured_activity');
    expect(result.decisioning.recommendation).not.toContain('线上直播和社群互动');
  });

  it('rejects candidate options that invent unconfirmed activity details', async () => {
    const provider: AiProvider = {
      async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
        if (input.taskType === 'quick.decisioning.options') {
          return {
            provider: 'test',
            model: 'test',
            promptVersion: 'test',
            inputTokens: 1,
            outputTokens: 1,
            output: {
              options: [
                {
                  id: 'bad_activity_detail',
                  title: '沉浸式读书会',
                  description: '增加茶歇、小奖品、角色扮演和思维导图，让活动更有参与感。',
                  pros: ['体验更丰富'],
                  cons: ['准备事项更多'],
                  isRecommended: true,
                },
              ],
              recommendation: '推荐加入茶歇、小奖品和角色扮演。',
            },
          };
        }
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {},
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会。',
      turns: [
        {
          role: 'user',
          content: '第一版只做活动宣传报名、现场签到、开场导读、分组讨论和结束反馈收集，不做长期社群运营、线上直播和付费课程。',
        },
        {
          role: 'user',
          content: '计划覆盖60名新生，实际到场不少于40人，平均满意度达到4分以上。',
        },
      ],
      forceDecisioning: true,
      modelEnabled: true,
      modelSkillIds: ['quick.decisioning.options'],
    });

    const combinedOutput = [
      result.decisioning.recommendation,
      ...result.decisioning.options.flatMap((option) => [
        option.title,
        option.description,
        ...option.pros,
        ...option.cons,
      ]),
    ].join('\n');
    expect(result.decisioning.options[0].id).toBe('option_structured_activity');
    expect(combinedOutput).not.toContain('茶歇');
    expect(combinedOutput).not.toContain('小奖品');
    expect(combinedOutput).not.toContain('角色扮演');
    expect(combinedOutput).not.toContain('思维导图');
  });

  it('does not let model structuring drop already stated constraint categories', async () => {
    const provider: AiProvider = {
      async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
        if (input.taskType === 'quick.structuring.understanding_patch') {
          return {
            provider: 'test',
            model: 'test',
            promptVersion: 'test',
            inputTokens: 1,
            outputTokens: 1,
            output: {
              understanding: {
                summary: '面向30名大学生组织线下读书会活动。',
                slots: {
                  expected_outcome: {
                    value: '线下读书会活动策划方案',
                    status: 'partial',
                    source: 'user',
                  },
                  target_user: { value: '30名大学生', status: 'partial', source: 'user' },
                  core_scenario: {
                    value: '线下读书会活动策划与执行',
                    status: 'partial',
                    source: 'user',
                  },
                  scope_boundary: {
                    value: '覆盖活动前宣传、现场活动执行和活动后反馈总结，不做报名系统、线上直播、付费课程或长期社群运营',
                    status: 'partial',
                    source: 'user',
                  },
                  completion_criteria: {
                    value: '至少25人到场、收集不少于20份反馈表、平均满意度4分以上',
                    status: 'partial',
                    source: 'user',
                  },
                  constraints_risks: {
                    value: '预算上限3000元，场地需校内教室或活动室，需确认教室是否可占用及设备可用性',
                    status: 'partial',
                    source: 'user',
                  },
                },
              },
              changedSlots: [
                'expected_outcome',
                'target_user',
                'core_scenario',
                'scope_boundary',
                'completion_criteria',
                'constraints_risks',
              ],
            },
          };
        }
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {},
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput:
        '我想做一个线下读书会活动策划方案，面向30名大学生，预算上限3000元，活动时间周五晚上，地点是校内教室或活动室。',
      turns: [
        {
          role: 'user',
          content:
            '第一版覆盖活动前宣传、现场活动执行和活动后反馈总结，不做报名系统、线上直播、付费课程或长期社群运营。成功标准是至少25人到场、收集不少于20份反馈表、平均满意度4分以上。',
        },
      ],
      modelEnabled: true,
      modelSkillIds: ['quick.structuring.understanding_patch'],
    });

    const constraints = result.structuring.understanding.slots.constraints_risks.value ?? '';
    expect(constraints).toContain('3000元');
    expect(constraints).toContain('周五晚上');
    expect(constraints).toContain('校内教室或活动室');
    expect(result.validation.unknowns.map((item) => item.slot)).not.toContain('constraints_risks');
  });

  it('extracts activity audience and measurable success criteria without confusing excluded operations', async () => {
    const runtime = new QuickConsultRuntime();
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会，但现在只知道大概想让大家愿意来参加。',
      turns: [
        {
          role: 'user',
          content: '第一版只做活动宣传报名、现场签到、开场导读、分组讨论和结束反馈收集，不做长期社群运营、线上直播和付费课程。',
        },
        {
          role: 'user',
          content: '计划覆盖60名新生，实际到场不少于40人；活动在开学第3周周五晚上、图书馆报告厅举办，时长90分钟；结束后收集反馈，平均满意度达到4分以上。',
        },
      ],
    });

    expect(result.structuring.understanding.slots.target_user.value).toContain('新生');
    expect(result.structuring.understanding.slots.target_user.value).not.toBe('运营');
    expect(result.structuring.understanding.slots.completion_criteria.value).toContain('40人');
    expect(result.structuring.understanding.slots.completion_criteria.value).toContain('4分');
  });

  it('keeps creative audience, scope, and options aligned with a poster brief', async () => {
    const runtime = new QuickConsultRuntime();
    const result = await runtime.run({
      originalInput:
        '我想做一组线下手作市集的推广海报文案和视觉简报，面向18到30岁的城市年轻人，主要投放小红书、朋友圈和线下立牌。第一版只需要主海报、3条社交媒体短文案和一版立牌标题，不做视频、不做品牌全案、不做付费投放计划。风格希望温暖、有生活感但不要过度可爱，必须突出周末、手作摊主、现场体验和免费入场。成功标准是活动前一周完成定稿，主办方内部3人评审通过，社交媒体点击率比上次活动高20%，线下现场至少300人到场。',
      forceDecisioning: true,
    });

    expect(result.structuring.understanding.slots.target_user.value).toContain('18到30岁的城市年轻人');
    expect(result.structuring.understanding.slots.target_user.value).not.toContain('小红书');
    expect(result.structuring.understanding.slots.scope_boundary.value).toContain('主海报');
    expect(result.structuring.understanding.slots.scope_boundary.value).toContain('不做视频');
    expect(result.decisioning.options[0].id).toBe('option_creative_grounded');
    expect(result.decisioning.recommendation).not.toContain('读书会');
    expect(result.decisioning.recommendation).not.toContain('共读');
  });

  it('rejects software options that positively propose excluded payment or credit features', async () => {
    const provider: AiProvider = {
      async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
        if (input.taskType === 'quick.decisioning.options') {
          return {
            provider: 'test',
            model: 'test',
            promptVersion: 'test',
            inputTokens: 1,
            outputTokens: 1,
            output: {
              options: [
                {
                  id: 'bad_payment',
                  title: '轻量支付对接版',
                  description: '对接校园一卡通或支付宝小程序支付，并加入校园社区信用版。',
                  pros: ['交易流程更完整'],
                  cons: ['需要额外开发'],
                  isRecommended: true,
                },
              ],
              recommendation: '推荐加入支付对接和信用体系。',
            },
          };
        }
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {},
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想做一个校园二手交易小程序。',
      turns: [
        {
          role: 'user',
          content:
            '面向本校学生，首版只做发布闲置、搜索筛选、留言预约、站内下架和举报，不接支付、不做跨校物流、不做复杂信用体系。希望4周内做出演示版，至少20个学生试用，完成一次发布到交易约见的流程。',
        },
      ],
      forceDecisioning: true,
      modelEnabled: true,
      modelSkillIds: ['quick.decisioning.options'],
    });

    const combinedOutput = [
      result.decisioning.recommendation,
      ...result.decisioning.options.flatMap((option) => [
        option.title,
        option.description,
        ...option.pros,
        ...option.cons,
      ]),
    ].join('\n');
    expect(result.decisioning.options[0].id).toBe('option_software_scope_first');
    expect(combinedOutput).not.toContain('轻量支付对接版');
    expect(combinedOutput).not.toContain('信用版');
  });

  it('describes social anxiety ideas without medicalizing the target user', async () => {
    const runtime = new QuickConsultRuntime();
    const result = await runtime.run({
      originalInput: '我有个社恐沟通训练的产品想法。',
      turns: [
        {
          role: 'user',
          content:
            '目标是帮助轻度社交紧张的人练习日常开口场景，比如问路、点餐、同事寒暄。现在还只是早期想法，首版想验证用户是否愿意练习、哪些场景最有用、反馈该怎么给。不做心理诊断、不做真人咨询、不做社区。',
        },
      ],
    });

    expect(result.structuring.understanding.slots.target_user.value).toContain('轻度社交紧张');
    expect(result.structuring.understanding.slots.target_user.value).not.toContain('患者');
    expect(result.structuring.understanding.slots.target_user.value).not.toContain('社交恐惧症');
    expect(result.structuring.understanding.slots.constraints_risks.status).toBe('partial');
  });

  it('keeps real-flow category slots stable after follow-up answers', async () => {
    const runtime = new QuickConsultRuntime();
    const academic = await runtime.run({
      originalInput: '我要写一篇关于生成式人工智能影响大学课程的论文。',
      turns: [
        {
          role: 'user',
          content:
            '课程是本科通识课，论文需要3000到5000字，重点分析AI对学习方式、教师评价和学术诚信的影响。材料以近三年中文政策、学校案例和3到5篇学术文献为主，不做问卷、不做实证实验，也不代写全文。希望形成题目、论点、结构、资料清单和写作计划，两周内完成初稿。',
        },
        {
          role: 'user',
          content: '论文只做结构和写作计划，不直接生成可提交全文，资料来源需要用户后续确认。',
        },
      ],
    });
    expect(academic.structuring.understanding.slots.target_user.value).toContain('课程导师');
    expect(academic.structuring.understanding.slots.target_user.value).not.toBe('用户');
    expect(academic.structuring.understanding.slots.completion_criteria.value).toContain('初稿');

    const collaboration = await runtime.run({
      originalInput: '我想做一个智能面试助手作为毕业设计。',
      turns: [
        {
          role: 'user',
          content:
            '目标是帮助求职者练习面试。首版包括岗位选择、模拟提问、回答记录、AI反馈和练习报告，不接真实企业招聘，不做付费，不做复杂权限。演示要覆盖学生用户从创建练习到查看反馈的完整流程，毕业答辩前8周完成，可以用模拟数据。',
        },
      ],
    });
    expect(collaboration.structuring.understanding.slots.core_scenario.value).toContain('从创建练习到查看反馈');
    expect(collaboration.structuring.understanding.slots.core_scenario.value).not.toMatch(/^反馈和练习报告/);

    const service = await runtime.run({
      originalInput: '我想优化健身房会员续费流程。',
      turns: [
        {
          role: 'user',
          content:
            '对象是即将到期和已经过期30天内的会员，现在线下前台和微信私聊都在做但很混乱。首版只规范提醒节奏、优惠话术、跟进记录、转介绍提示和异常处理，不新做系统也不改支付。目标是减少漏跟进，续费率提升10%，店长每周能看一次记录。',
        },
      ],
    });
    expect(service.structuring.understanding.slots.completion_criteria.value).toContain('续费率提升10%');
    expect(service.structuring.understanding.slots.completion_criteria.value).not.toBe('待补充');
  });

  it('does not treat placeholder model slot values as confirmed facts', async () => {
    const provider: AiProvider = {
      async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
        if (input.taskType === 'quick.structuring.understanding_patch') {
          return {
            provider: 'test',
            model: 'test',
            promptVersion: 'test',
            inputTokens: 1,
            outputTokens: 1,
            output: {
              understanding: {
                summary: '办线下读书分享会',
                slots: {
                  expected_outcome: { value: '让大学新生愿意来参加线下读书分享会', status: 'partial', source: 'user' },
                  target_user: { value: '大学新生', status: 'partial', source: 'user' },
                  core_scenario: { value: '线下读书分享会', status: 'partial', source: 'user' },
                  scope_boundary: {
                    value: '本次只做活动宣传报名、现场签到、开场导读、分组讨论和结束反馈收集',
                    status: 'partial',
                    source: 'user',
                  },
                  completion_criteria: { value: '待确认', status: 'partial', source: 'assistant_inferred' },
                  constraints_risks: { value: '待确认', status: 'partial', source: 'assistant_inferred' },
                },
              },
              changedSlots: ['expected_outcome', 'target_user', 'core_scenario', 'scope_boundary', 'completion_criteria'],
            },
          };
        }
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {},
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会。',
      turns: [
        {
          role: 'user',
          content: '第一版只做活动宣传报名、现场签到、开场导读、分组讨论和结束反馈收集。',
        },
      ],
      modelEnabled: true,
      modelSkillIds: ['quick.structuring.understanding_patch'],
    });

    expect(result.structuring.understanding.slots.completion_criteria.value).toBeNull();
    expect(result.validation.canEnterReview).toBe(false);
    expect(result.validation.unknowns.map((item) => item.slot)).toContain('completion_criteria');
  });

  it('falls back when model-generated report leaks internal terms', async () => {
    const provider: AiProvider = {
      async invoke(): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {
            views: {
              simple: `# 需求简报（概述）\n${'用户可读内容。'.repeat(80)}`,
              exec: `# 需求分析详细报告\n## 报告摘要\n目标 参与对象 核心场景 范围 完成标准 风险 后续\n本报告依据 snapshot 生成。\n${'专业内容。'.repeat(260)}`,
            },
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会。',
      turns: [
        { role: 'user', content: '主要面向大一新生。' },
        { role: 'user', content: '周五晚上在图书馆报告厅做90分钟。' },
        { role: 'user', content: '只做报名、现场导读、分组讨论和结束反馈，不做长期社群运营。' },
        { role: 'user', content: '完成标准是报名不少于60人、到场不少于40人、满意度4分以上。' },
      ],
      forceBrief: true,
      modelEnabled: true,
      modelSkillIds: ['quick.composition.brief_views'],
    });

    expect(result.composition.views.exec).not.toContain('snapshot');
    expect(result.composition.views.exec).toContain('当前版本来自本次快速问诊记录');
  });

  it('falls back when model-generated detailed report lacks the ReqClinic report structure', async () => {
    const provider: AiProvider = {
      async invoke(): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {
            views: {
              simple: `# 需求简报（概述）\n${'用户可读内容。'.repeat(80)}`,
              exec: `# 需求分析详细报告\n## 报告摘要\n## 目标与背景\n## 参与对象\n## 核心场景\n## 范围边界\n## 完成标准\n## 风险与待确认事项\n## 后续动作\n| 编号 | 需求描述 |\n| --- | --- |\n| R1 | AI生成至少3个备选论文题目 |\n${'专业内容。'.repeat(260)}`,
            },
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我要写一篇关于生成式人工智能影响大学课程的论文。',
      turns: [
        {
          role: 'user',
          content:
            '课程是本科通识课，论文需要3000到5000字，重点分析AI对学习方式、教师评价和学术诚信的影响。材料以近三年中文政策、学校案例和3到5篇学术文献为主，不做问卷、不做实证实验，也不代写全文。希望形成题目、论点、结构、资料清单和写作计划，两周内完成初稿。',
        },
      ],
      forceBrief: true,
      modelEnabled: true,
      modelSkillIds: ['quick.composition.brief_views'],
    });

    expect(result.composition.views.exec).toContain('需求-001');
    expect(result.composition.views.exec).toContain('用户场景与独立验证');
    expect(result.composition.views.exec).not.toContain('AI生成至少3个备选论文题目');
  });

  it('falls back when model-generated report invents numeric facts', async () => {
    const provider: AiProvider = {
      async invoke(): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 1,
          outputTokens: 1,
          output: {
            views: {
              simple: `# 需求简报（概述）\n${'用户可读内容。'.repeat(80)}`,
              exec: `# 需求分析详细报告\n## 报告摘要\n目标 参与对象 核心场景 范围 完成标准 风险 后续\n当前阶段计划回收2800份问卷。\n${'专业内容。'.repeat(260)}`,
            },
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想做一个关于大学生使用AI学习工具的调研论文。',
      turns: [
        { role: 'user', content: '研究对象是本科生。' },
        { role: 'user', content: '只做问卷和10名学生访谈，不做实验干预。' },
        { role: 'user', content: '完成标准是计划回收不少于300份有效问卷。' },
        { role: 'user', content: '交付开题报告、问卷大纲、访谈提纲和初步分析报告。' },
      ],
      forceBrief: true,
      modelEnabled: true,
      modelSkillIds: ['quick.composition.brief_views'],
    });

    expect(result.composition.views.exec).not.toContain('2800份');
    expect(result.composition.views.exec).toContain('300份');
  });

  it('falls back when model-generated report invents unprovided capabilities', async () => {
    const provider: AiProvider = {
      async invoke(): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 11,
          outputTokens: 22,
          thinkingMode: 'enabled',
          usageEstimated: false,
          output: {
            views: {
              simple: `# 需求简报（概述）\n用户输入一句话生成海报，系统提供上传图片、分享链接和无需登录能力。\n${'用户可读内容。'.repeat(80)}`,
              exec: `# 需求分析详细报告\n## 报告摘要\n## 目标与背景\n## 参与对象\n## 核心场景\n## 范围边界\n## 完成标准\n## 风险与待确认事项\n## 后续动作\n支持至少3种模板、上传图片、分享链接、无需注册登录。\n${'专业内容。'.repeat(260)}`,
            },
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想做一个智能海报生成网站，用户输入一句话就能生成可在线访问的海报网页。',
      turns: [
        { role: 'user', content: '主要给团队宣传岗使用。' },
        { role: 'user', content: '输入一句话后生成，手机扫码查看。' },
        { role: 'user', content: '首版只做单页网页海报生成。' },
        { role: 'user', content: '完成标准是从输入完成到海报出来不超过30秒。' },
      ],
      forceBrief: true,
      modelEnabled: true,
      modelSkillIds: ['quick.composition.brief_views'],
    });

    expect(result.composition.views.exec).not.toContain('上传图片');
    expect(result.composition.views.exec).not.toContain('分享链接');
    expect(result.composition.views.exec).not.toContain('无需注册');
    expect(result.composition.views.exec).not.toContain('至少3种模板');
    expect(result.composition.views.exec).toContain('需求质量检查');
    expect(result.audit.find((audit) => audit.skillId === 'quick.composition.brief_views')?.inputTokens).toBe(11);
  });

  it('does not let non-software reports drift into software delivery wording', async () => {
    const provider: AiProvider = {
      async invoke(): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 5,
          outputTokens: 9,
          thinkingMode: 'disabled',
          usageEstimated: false,
          output: {
            views: {
              simple: `# 需求简报（概述）\n${'用户可读内容。'.repeat(80)}`,
              exec: `# 需求分析详细报告\n## 报告摘要\n## 目标与背景\n## 参与对象\n## 核心场景\n## 范围边界\n## 完成标准\n## 风险与待确认事项\n## 后续动作\n需要开发报名系统、登录、数据库和接口。\n${'专业内容。'.repeat(260)}`,
            },
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会。',
      turns: [
        { role: 'user', content: '主要面向大一新生。' },
        { role: 'user', content: '周五晚上在图书馆报告厅做90分钟。' },
        { role: 'user', content: '只做报名、现场导读、分组讨论和结束反馈，不做长期社群运营。' },
        { role: 'user', content: '完成标准是报名不少于60人、到场不少于40人、满意度4分以上。' },
      ],
      forceBrief: true,
      modelEnabled: true,
      modelSkillIds: ['quick.composition.brief_views'],
    });

    expect(result.composition.views.exec).not.toContain('报名系统');
    expect(result.composition.views.exec).not.toContain('数据库');
    expect(result.composition.views.exec).toContain('现场导读');
  });

  it('falls back when model-generated report invents concrete examples', async () => {
    const provider: AiProvider = {
      async invoke(): Promise<AiInvokeResult> {
        return {
          provider: 'test',
          model: 'test',
          promptVersion: 'test',
          inputTokens: 7,
          outputTokens: 9,
          output: {
            views: {
              simple: `# 需求简报（概述）\n建议围绕《小王子》做经典书深度共读，并安排茶歇。\n${'用户可读内容。'.repeat(90)}`,
              exec: `# 需求分析详细报告\n## 报告摘要\n## 目标与背景\n## 参与对象\n## 核心场景\n## 范围边界\n## 完成标准\n## 风险与待确认事项\n## 后续动作\n建议通过大学社团和班级群传播，预算包含场地租赁、茶歇、物料打印、书籍购买。\n${'专业内容。'.repeat(260)}`,
            },
          },
        };
      },
    };
    const runtime = new QuickConsultRuntime(provider);
    const result = await runtime.run({
      originalInput: '我想办一个面向大学新生的线下读书分享会。',
      turns: [
        { role: 'user', content: '主要面向大一新生。' },
        { role: 'user', content: '周五晚上做90分钟。' },
        { role: 'user', content: '只做报名、现场导读、分组讨论和结束反馈，不做长期社群运营。' },
        { role: 'user', content: '完成标准是报名不少于60人、到场不少于40人、满意度4分以上。' },
      ],
      forceBrief: true,
      modelEnabled: true,
      modelSkillIds: ['quick.composition.brief_views'],
    });

    const combinedOutput = `${result.composition.views.simple}\n${result.composition.views.exec}`;
    expect(combinedOutput).not.toContain('《小王子》');
    expect(combinedOutput).not.toContain('茶歇');
    expect(combinedOutput).not.toContain('场地租赁');
    expect(combinedOutput).not.toContain('大学社团');
    expect(combinedOutput).toContain('需求质量检查');
    expect(combinedOutput).toContain('报名不少于60人');
  });

  it('generates ordinary overview wording and professional detailed report from one snapshot', async () => {
    const runtime = new QuickConsultRuntime();
    const result = await runtime.run({
      originalInput: '我想做一个智能海报生成网站，用户输入一句话就能生成可在线访问的海报网页，30秒内能出结果。',
      turns: [
        { role: 'user', content: '主要是团队宣传岗的同事，个人创作者是次要的。' },
        { role: 'user', content: '输入一句话后系统生成，手机扫码就能看。' },
        { role: 'user', content: '首版只做单页网页海报生成，不做编辑器、团队协作和图片导出。' },
        { role: 'user', content: '从输入完成到海报出来不超过30秒。' },
      ],
      forceBrief: true,
    });

    expect(result.validation.canEnterReview).toBe(true);
    expect(result.elicitation.question).toBeNull();
    expect(result.composition.snapshot.understanding.slots.scope_boundary.value).toContain('单页网页海报');
    expect(result.composition.snapshot.understanding.slots.core_scenario.value).toContain('手机扫码查看');
    expect(result.composition.snapshot.understanding.slots.core_scenario.value).not.toContain('分享');
    expect(result.composition.views.simple).toContain('目前已经说清楚');
    expect(result.composition.views.simple).not.toContain('需求-001');
    expect(result.composition.views.exec).toContain('需求-001');
    expect(result.composition.views.exec).toContain('标准-001');
    expect(result.composition.views.exec).toContain('用户场景与独立验证');
    expect(result.composition.views.exec).not.toContain('给智能助手');
  });

  it('keeps the AI poster demo case aligned while leaving fixture-only details unconfirmed', async () => {
    const fixtureDir = join(process.cwd(), '..', 'ReqClinic', 'fixtures', 'ai-poster-website');
    const scenario = JSON.parse(
      readFileSync(join(fixtureDir, 'scenario.json'), 'utf8'),
    ) as { original_input: string };
    const clarifyingQa = JSON.parse(
      readFileSync(join(fixtureDir, 'clarifying-qa.json'), 'utf8'),
    ) as { turns: QuickTurn[] };
    const fixtureUnderstanding = JSON.parse(
      readFileSync(join(fixtureDir, 'understanding.json'), 'utf8'),
    ) as { slots: Record<string, string> };

    const runtime = new QuickConsultRuntime();
    const result = await runtime.run({
      originalInput: scenario.original_input,
      turns: clarifyingQa.turns.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      forceBrief: true,
    });

    const slots = result.structuring.understanding.slots;
    const combinedOutput = [
      result.composition.views.simple,
      result.composition.views.exec,
      ...Object.values(slots).map((slot) => slot.value ?? ''),
    ].join('\n');

    expect(result.routing.domainPackId).toBe('software-delivery');
    expect(result.validation.canEnterReview).toBe(true);
    expect(slots.expected_outcome.value).toContain('网页海报');
    expect(slots.expected_outcome.value).toContain('手机');
    expect(slots.target_user.value).toContain('团队宣传岗');
    expect(slots.target_user.value).toContain('个人创作者');
    expect(slots.core_scenario.value).toContain('扫码');
    expect(slots.scope_boundary.value).toContain('协作');
    expect(slots.scope_boundary.value).toContain('二次修改');
    expect(slots.completion_criteria.value).toContain('不超过30秒');
    expect(result.validation.unknowns.map((item) => item.slot)).toContain('constraints_risks');

    expect(combinedOutput).toContain('需求-001');
    expect(combinedOutput).toContain('需求质量检查');
    expect(combinedOutput).not.toContain('0.5元');
    expect(combinedOutput).not.toContain('移动端首屏≤1秒');

    expect(fixtureUnderstanding.slots.expected_outcome).toContain('网页海报');
    expect(fixtureUnderstanding.slots.target_user).toContain('团队宣传岗');
    expect(fixtureUnderstanding.slots.completion_criteria).toContain('30秒');
  });
});
