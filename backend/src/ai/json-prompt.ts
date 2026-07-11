import { promptVersionFor } from './prompt-versions';
import type { AiInvokeInput } from './provider';

const JSON_SYSTEM_PROMPT =
  '你是 ReqClinic 的受控需求分析 skill。只输出一个合法 JSON 对象，不输出 Markdown、解释、代码块或额外文本。';

export function buildJsonMessages(input: AiInvokeInput): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: JSON_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: buildPrompt(input),
    },
  ];
}

export function buildPrompt(input: AiInvokeInput): string {
  return [
    `task_type: ${input.taskType}`,
    `prompt_version: ${promptVersionFor(input.taskType)}`,
    '要求：',
    '1. 只返回 JSON 对象。',
    '2. 不要编造用户没有提供的确定事实；不确定内容用“待确认”。',
    '3. 快速问诊由 AI 主动提问，问题必须具体、一次只问一个重点。',
    '4. 概述使用普通用户能直接理解的中文；详细报告可以使用专业需求分析结构。',
    '5. 不要出现 slot、schema、agent、skill、blocking、understanding_review 等面向开发者的词。',
    '6. 必须严格使用下面的输出 JSON 结构，不要添加外层 data/result 字段。',
    taskInstructionFor(input.taskType),
    '输出 JSON 结构：',
    outputContractFor(input.taskType),
    '输入 JSON：',
    JSON.stringify(input.payload, null, 2),
  ].join('\n');
}

export function outputContractFor(taskType: string): string {
  switch (taskType) {
    case 'quick.routing.domain_risk':
      return JSON.stringify(
        {
          mode: 'quick',
          domainPackId: 'general',
          candidateDomainPacks: ['general'],
          riskFlags: ['如果没有风险则返回空数组'],
          routingReason: '一句话说明判断依据',
        },
        null,
        2,
      );
    case 'quick.structuring.understanding_patch':
      return JSON.stringify(
        {
          understanding: {
            summary: '一句话总结当前理解，不超过 80 个中文字符',
            slots: {
              expected_outcome: { value: 'string 或 null', status: 'partial', source: 'user' },
              target_user: { value: 'string 或 null', status: 'partial', source: 'user' },
              core_scenario: { value: 'string 或 null', status: 'partial', source: 'user' },
              scope_boundary: { value: 'string 或 null', status: 'partial', source: 'user' },
              completion_criteria: { value: 'string 或 null', status: 'partial', source: 'user' },
              constraints_risks: { value: 'string 或 null', status: 'inferred', source: 'assistant_inferred' },
            },
          },
          changedSlots: ['expected_outcome'],
        },
        null,
        2,
      );
    case 'quick.validation.coverage_gate':
      return JSON.stringify(
        {
          canEnterReview: false,
          nextQuestionSlot: 'target_user',
          unknowns: [
            {
              id: 'unknown_target_user',
              slot: 'target_user',
              label: '目标用户',
              question: '一个具体问题',
              impact: '影响说明',
              priorityScore: 90,
              status: '影响较大，建议先确认',
              isBlocking: true,
            },
          ],
          qualityIssues: [
            {
              dimension: '清晰度',
              userLabel: '给用户看的自然说明',
              internalCode: 'quick_quality_target_user',
              severity: 'blocking',
              suggestedQuestion: '一个具体问题',
              priorityScore: 90,
            },
          ],
        },
        null,
        2,
      );
    case 'quick.elicitation.next_question':
      return JSON.stringify(
        {
          question: '只问一个结合当前任务上下文的具体问题；如果无需继续追问则为 null',
          slot: 'target_user',
          rationale: '为什么优先问这个问题',
        },
        null,
        2,
      );
    case 'quick.decisioning.options':
      return JSON.stringify(
        {
          options: [
            {
              id: 'option_focused_v1',
              title: '方案名称',
              description: '方案说明',
              pros: ['优势'],
              cons: ['代价或风险'],
              isRecommended: true,
            },
          ],
          recommendation: '推荐理由',
        },
        null,
        2,
      );
    case 'quick.composition.brief_views':
      return JSON.stringify(
        {
          views: {
            simple: [
              '# 需求简报（概述）',
              '面向普通用户的短段落，数组每项是一行 Markdown。',
              '建议 650-1000 个中文字符，说明现在理解了什么、还要注意什么、下一步怎么做。',
            ],
            exec: [
              '# 需求分析详细报告',
              '专业详细报告，数组每项是一行 Markdown，避免在 JSON 字符串中直接写多行内容。',
              '建议 2200-3200 个中文字符，至少包含：报告摘要、目标与背景、参与对象、核心场景、范围边界、需求清单、完成标准、风险与待确认事项、方案建议、后续动作。',
            ],
          },
        },
        null,
        2,
      );
    case 'formal_guidance':
      return JSON.stringify(
        {
          result_type: 'formal_map_snapshot',
          title: '项目名称',
          summary: '不超过120字的当前项目理解',
          projectType: '活动策划 / 软件项目 / 外包采购 / 学术写作 / 服务流程 / 通用项目',
          sourceContext: 'direct 或 quick_upgrade 的自然语言说明',
          currentModuleId: 'scope',
          nextQuestion: '下一轮只问一个具体问题',
          generationSteps: [
            { label: '整理起点', state: 'done' },
            { label: '划分模块', state: 'done' },
            { label: '继续追问', state: 'active' },
            { label: '生成报告', state: 'pending' },
          ],
          modules: [
            {
              id: 'scope',
              title: '范围与边界',
              status: '正在梳理',
              summary: '节点摘要',
              known: ['用户已明确提供的内容'],
              assumptions: ['系统推测但需要确认的内容'],
              questions: ['需要继续确认的问题'],
              options: [
                {
                  id: 'scope_option_a',
                  title: '方案名称',
                  fit: '适用情况',
                  tradeoff: '主要取舍',
                  recommended: true,
                },
              ],
              relatedModuleIds: ['risk'],
            },
          ],
          unresolvedItems: [
            {
              id: 'unknown_owner',
              label: '确认人',
              detail: '尚未明确由谁最终确认',
              impact: '影响正式验收与交付责任',
            },
          ],
          reportProjection: {
            overview: '面向普通用户的自然中文概述，避免专业术语堆叠。',
            detailedReport: '专业需求分析文档，使用 Markdown 标题、清单和表格；必须来自同一份地图快照。',
          },
          qualityNotes: ['只写对用户有用的质量提示，不出现内部状态词。'],
        },
        null,
        2,
      );
    default:
      return JSON.stringify({ ok: true }, null, 2);
  }
}

export function parseJsonObject(content: string, providerLabel: string): unknown {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`${providerLabel} returned no JSON object`);
    }
    return JSON.parse(match[0]);
  }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function taskInstructionFor(taskType: string): string {
  switch (taskType) {
    case 'quick.structuring.understanding_patch':
      return [
        '本任务补充约束：',
        '- 只把用户明确说过的内容写成 user；合理推断但未直接说出的内容写成 assistant_inferred。',
        '- 完成标准中的数字、时间、预算、地点、人数必须尽量完整保留。',
        '- 范围边界要同时覆盖“本次做什么”和“本次不做什么”。',
      ].join('\n');
    case 'quick.elicitation.next_question':
      return [
        '本任务补充约束：',
        '- 问题要像专业顾问追问客户一样自然、具体。',
        '- 不要让用户“补充完整需求”；只能围绕当前影响最大的一个缺口提问。',
      ].join('\n');
    case 'quick.decisioning.options':
      return [
        '本任务补充约束：',
        '- 方案要有明确差异，不要只是换词。',
        '- 快速问诊只能给候选方向和推荐理由，不能说成正式立项决策。',
      ].join('\n');
    case 'quick.composition.brief_views':
      return [
        '本任务补充约束：',
        '- simple 用普通用户能看懂的自然中文，不使用 FR、P0、验收口径等专业编号。',
        '- exec 使用专业需求分析文档风格，可以使用表格、编号和清单。',
        '- exec 必须能指导后续执行：对象、场景、范围、完成标准、风险、待确认事项都要清楚。',
        '- 如果任务不是软件或数字产品，不要写系统、功能、接口、数据库、登录、App、网页等软件交付词；请改用环节、流程、人员、物料、宣传、执行、反馈等表达。',
        '- 两个视图只能基于 snapshot，不要新增地点、预算、角色、功能或承诺。',
      ].join('\n');
    case 'formal_guidance':
      return [
        '本任务补充约束：',
        '- 这是正式项目的需求地图，不是快速简报；快速简报来源只能作为候选依据，不能直接当作正式结论。',
        '- 根据主题生成 4 到 9 个模块，模块数量可以随项目复杂度变化；不要套固定软件模板。',
        '- 用户可能在做活动策划、学术写作、外包采购、服务流程、软件产品或其他项目；请先判断主题，再选择合适模块。',
        '- 模块标题必须是普通中文用户能理解的表达，例如“活动目标”“受众与触达”“范围与排除项”“验收与交付”，不要写 agent、skill、slot、schema、blocking。',
        '- 已明确内容只能来自输入或对话；合理推测放到 assumptions；缺口放到 questions/unresolvedItems。',
        '- 仍有关键缺口时，nextQuestion 必须是一个具体、自然、有优先级的问题，不能让用户自己补完整需求；本轮关键问题全部覆盖时返回 null。',
        '- 提问数量由模块缺口决定，不以固定轮数结束；一次只追问当前影响最大的一个问题。',
        '- overview 面向普通用户；detailedReport 用专业需求分析报告结构，能指导后续执行。',
        '- 不要输出正式批准、最终决策、已基线化、已验收等结论。',
      ].join('\n');
    default:
      return '本任务补充约束：按输入和输出结构完成。';
  }
}
