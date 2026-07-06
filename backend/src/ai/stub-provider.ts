import type { AiProvider, AiInvokeInput, AiInvokeResult } from './provider';
import { promptVersionFor } from './prompt-versions';

/**
 * Deterministic in-process AI provider (§9).
 *
 * Used by tests and by the JobWorker when no real model backend is configured.
 * Output is a pure function of `taskType` (and, where relevant, the input
 * payload) so tests can assert exact byte-for-byte results, and the schema gate
 * in `schema-gates.ts` is exercised against realistic shapes on every run.
 *
 * The stub never throws: a malformed `payload` still yields a structurally
 * valid default so the worker can drive the full state machine without special
 * handling for "stub mode".
 */

const STUB_PROVIDER = 'stub';
const STUB_MODEL = 'stub-v1';

/** Pull a string array from the payload under `source_ids` (best effort). */
function readSourceIds(payload: unknown): string[] {
  if (payload && typeof payload === 'object') {
    const v = (payload as Record<string, unknown>).source_ids;
    if (Array.isArray(v)) return v.map((x) => String(x));
  }
  return [];
}

function readProjectId(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const v = (payload as Record<string, unknown>).project_id;
    if (typeof v === 'string') return v;
  }
  return null;
}

/** Build the deterministic output for a taskType. */
function buildOutput(input: AiInvokeInput): unknown {
  switch (input.taskType) {
    case 'domain_profile': {
      const sources = readSourceIds(input.payload);
      return {
        work_type: 'software-delivery',
        domain_labels: ['软件交付', '需求工程'],
        risk_flags: ['范围蔓延', '技术债'],
        terminology_map: {
          需求: 'requirement',
          验收标准: 'acceptance_criterion',
        },
        suggested_pack_ids: ['software-delivery', 'general'],
        required_human_roles: ['需求工程师', '架构师'],
        routing_risk: 'medium',
        routing_basis: { complexity: 'medium', source_count: sources.length },
        rationale_evidence_links: sources,
        unknowns: [
          { question: '是否需要多语言支持？', status: 'open' },
        ],
      };
    }
    case 'project_candidates': {
      return {
        candidates: [
          { id: 'general', label: '通用领域配置' },
          { id: 'software-delivery', label: '软件交付领域配置' },
        ],
      };
    }
    case 'analysis_extraction': {
      const pid = readProjectId(input.payload);
      return {
        result_type: 'analysis_result',
        outcomes: [
          { id: 'oc_1', project_id: pid, statement: '提升需求交付可追溯性' },
        ],
        requirements: [
          { id: 'req_1', project_id: pid, statement: '系统应支持需求版本管理' },
        ],
        drivers: [
          { id: 'drv_1', project_id: pid, statement: '合规审计要求' },
        ],
        conflicts: [],
      };
    }
    case 'brief_generation': {
      return {
        result_type: 'brief',
        brief: {
          title: '需求简报',
          summary: '基于问诊记录生成的需求简报候选。',
        },
      };
    }
    case 'formal_guidance': {
      const pid = readProjectId(input.payload);
      return {
        result_type: 'formal_map_snapshot',
        title: '正式项目需求地图',
        summary: '已根据项目起点生成可继续追问的需求地图候选。',
        projectType: '通用项目',
        sourceContext: pid ? `项目 ${pid} 的初始说明` : '项目初始说明',
        currentModuleId: 'scope',
        nextQuestion: '第一版必须交付哪些结果，哪些内容明确不做？',
        generationSteps: [
          { label: '整理起点', state: 'done' },
          { label: '划分模块', state: 'done' },
          { label: '继续追问', state: 'active' },
          { label: '生成报告', state: 'pending' },
        ],
        modules: [
          {
            id: 'goal',
            title: '项目目标',
            status: '正在梳理',
            summary: '确认项目要解决的问题和希望达成的结果。',
            known: ['已记录项目起点。'],
            assumptions: ['目标需要由负责人再次确认。'],
            questions: ['最重要的成功结果是什么？'],
            options: [],
            relatedModuleIds: ['scope'],
          },
          {
            id: 'scope',
            title: '范围与边界',
            status: '有方案可选',
            summary: '说明本次包含什么、不包含什么，以及后续变化如何处理。',
            known: ['已有初步项目描述。'],
            assumptions: ['第一版应先控制范围。'],
            questions: ['第一版必须包含哪些结果，哪些明确不做？'],
            options: [
              {
                id: 'scope_first',
                title: '先定首版范围',
                fit: '适合先形成可执行版本。',
                tradeoff: '长期能力需要后续补充。',
                recommended: true,
              },
            ],
            relatedModuleIds: ['risk', 'report'],
          },
          {
            id: 'risk',
            title: '风险与取舍',
            status: '建议确认',
            summary: '识别影响成本、时间和承诺的关键风险。',
            known: [],
            assumptions: ['约束不明确会影响方案选择。'],
            questions: ['哪些风险会影响成本、时间或交付承诺？'],
            options: [],
            relatedModuleIds: ['scope'],
          },
          {
            id: 'report',
            title: '报告与后续动作',
            status: '待补充',
            summary: '从同一份需求地图生成报告，并保留待确认内容。',
            known: ['报告应来自当前地图。'],
            assumptions: ['未确认内容不能写成最终结论。'],
            questions: ['报告主要给谁看，用于沟通、评审还是执行？'],
            options: [],
            relatedModuleIds: ['goal', 'scope'],
          },
        ],
        unresolvedItems: [
          {
            id: 'unknown_owner',
            label: '最终确认人',
            detail: '尚未明确由谁确认项目可以交付。',
            impact: '影响报告责任和后续验收。',
          },
        ],
        reportProjection: {
          overview: '当前已经形成正式项目的初步需求地图。建议先确认目标、范围、风险和报告使用对象，再进入更完整的需求分析报告。',
          detailedReport: '# 正式项目需求分析报告\n\n## 1. 项目概述\n\n当前项目仍处于澄清阶段，已有信息足以生成初步需求地图，但不能作为最终验收结论。\n\n## 2. 重点待确认\n\n- 第一版必须交付的结果。\n- 明确不做的范围。\n- 最终确认人和报告使用对象。\n\n## 3. 建议下一步\n\n围绕当前地图节点逐项回答问诊问题，更新地图后再导出详细报告。',
        },
        qualityNotes: ['此输出为兜底地图，重要内容仍需负责人确认。'],
      };
    }
    case 'understanding_review': {
      return {
        result_type: 'understanding_review',
        coverage: {
          expected_outcome: { filled: true },
          user_object: { filled: true },
          core_scenario: { filled: false },
        },
        gaps: [
          { slot: 'core_scenario', question: '请补充核心使用场景。' },
        ],
      };
    }
    case 'training_question': {
      return {
        result_type: 'training_question',
        question: '下列哪项属于功能性需求？',
        options: ['响应时间≤200ms', '支持多语言', '每日备份', '可用性 99.9%'],
      };
    }
    case 'training_response': {
      // §11.1 角色回答 Prompt 原则兜底：不泄露 answer_key，不使用"作为 AI"
      // 之类说法，保持客户人设，只回答用户问到的内容。
      return {
        result_type: 'training_response',
        role_answer: {
          content:
            '我现在只能说大致的方向：这次最在意的是把目标说清楚，再谈范围。具体细节我们可以一项项过。',
          tone: 'customer',
          disclosed_rule_ids: [],
          safe_to_show: true,
        },
        coach_projection: {
          next_hint: '可以接着问对方最想先确认的目标是什么，避免一次问太多。',
          question_quality_note: '当前问题偏宽泛，建议聚焦到一个具体维度。',
          visible_progress_label: '正在澄清目标',
        },
      };
    }
    case 'training_feedback': {
      // §11.2 教练反馈 Prompt 原则兜底：先肯定已覆盖内容，再指出遗漏；
      // 不使用开发者术语，不把本轮分数说成能力认证，不把答案写成唯一标准答案。
      return {
        result_type: 'training_feedback',
        score: {
          total: 60,
          max: 100,
          label: '已覆盖部分关键点，仍有改进空间',
        },
        dimensions: [
          {
            dimension: 'target_clarification',
            score: 12,
            max: 20,
            evidence: '已经问到目标方向，但未进一步确认可衡量的成功结果。',
            improvement: '追问对方最想先看到的可观察结果，以及如何判断达成。',
          },
          {
            dimension: 'user_scenario',
            score: 10,
            max: 20,
            evidence: '提到了使用场景，但缺少主要使用路径与边界。',
            improvement: '请对方描述一两个具体使用路径，并标出边界。',
          },
          {
            dimension: 'scope_boundary',
            score: 8,
            max: 20,
            evidence: '尝试确认范围，但没有明确哪些不做。',
            improvement: '直接询问哪些内容明确不在这一版范围内。',
          },
          {
            dimension: 'constraint_analysis',
            score: 6,
            max: 20,
            evidence: '少量涉及约束，未追问时间、合规与资源限制。',
            improvement: '把约束拆成时间、合规、资源三项分别追问。',
          },
          {
            dimension: 'completion_criteria',
            score: 4,
            max: 20,
            evidence: '验收标准尚未具体，缺少可观察的完成信号。',
            improvement: '确认什么情况下认为本次练习已经达成目标。',
          },
        ],
        missed_high_value_questions: [
          '本次最希望先看到什么结果？',
          '哪些内容明确不在这一版范围内？',
          '什么情况下认为这次练习已经达成目标？',
        ],
        improvement_examples: [
          {
            before: '这个项目要做什么？',
            after: '这次最想先达成哪个可观察的结果？后续可以分阶段实现。',
            reason: '聚焦到一个可观察的结果，更利于后续追问范围和验收。',
          },
          {
            before: '有什么风险？',
            after: '在时间、合规和资源这几方面，目前最不确定的是哪一项？',
            reason: '把风险拆成具体维度，对方更容易给出有用回答。',
          },
        ],
        summary_review: {
          accuracy: '当前总结覆盖了目标方向和使用场景的大意，但范围、约束与验收仍偏笼统。',
          missing_points: [
            '可衡量的成功结果',
            '明确不做的范围',
            '时间、合规与资源的具体约束',
          ],
          unsupported_claims: [],
          improved_summary:
            '本次练习澄清了目标方向与主要使用场景；建议下一步把可观察的成功结果、明确不做的范围，以及关键约束逐项确认，再形成可执行的验收口径。',
        },
      };
    }
    default:
      return { result_type: 'unknown', task_type: input.taskType };
  }
}

export class StubProvider implements AiProvider {
  async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
    const output = buildOutput(input);
    return {
      output,
      provider: STUB_PROVIDER,
      model: STUB_MODEL,
      promptVersion: promptVersionFor(input.taskType),
      inputTokens: 64,
      outputTokens: 128,
      thinkingMode: 'disabled',
      usageEstimated: true,
    };
  }
}
