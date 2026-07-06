import { afterEach, describe, expect, it, vi } from 'vitest';
import { StubProvider } from '../src/ai/stub-provider';
import { OpenAiCompatibleProvider } from '../src/ai/openai-compatible-provider';
import { validateOutput, SCHEMA_GATE_ERROR_CODE } from '../src/ai/schema-gates';
import { promptVersionFor, PROMPT_VERSIONS } from '../src/ai/prompt-versions';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * StubProvider + schema-gate tests (Task 19).
 *
 * Asserts that each taskType yields a deterministic, structurally-valid output
 * that passes its Zod schema gate. The JobWorker relies on both invariants.
 */
describe('StubProvider (Task 19)', () => {
  const provider = new StubProvider();

  const TASK_TYPES = [
    'domain_profile',
    'project_candidates',
    'analysis_extraction',
    'brief_generation',
    'understanding_review',
    'training_response',
    'training_feedback',
  ] as const;

  it.each(TASK_TYPES)('returns a deterministic result for taskType=%s', async (taskType) => {
    const a = await provider.invoke({ taskType, payload: {} });
    const b = await provider.invoke({ taskType, payload: {} });
    expect(a).toEqual(b);
    expect(a.provider).toBe('stub');
    expect(a.model).toBe('stub-v1');
    expect(a.promptVersion).toBe(promptVersionFor(taskType));
    expect(a.inputTokens).toBeGreaterThan(0);
    expect(a.outputTokens).toBeGreaterThan(0);
  });

  it('produces a schema-valid domain_profile output', async () => {
    const result = await provider.invoke({
      taskType: 'domain_profile',
      payload: { source_ids: ['SRC_1', 'SRC_2'] },
    });
    const gate = validateOutput('domain_profile', result.output);
    expect(gate.ok).toBe(true);

    const output = gate.data as Record<string, unknown>;
    expect(output.work_type).toBe('software-delivery');
    expect(output.routing_risk).toBe('medium');
    expect(output.suggested_pack_ids).toEqual(['software-delivery', 'general']);
    // source_ids propagate into rationale_evidence_links via the stub
    expect(output.rationale_evidence_links).toEqual(['SRC_1', 'SRC_2']);
  });

  it('produces a schema-valid analysis_extraction output', async () => {
    const result = await provider.invoke({
      taskType: 'analysis_extraction',
      payload: { project_id: 'PRJ_1' },
    });
    const gate = validateOutput('analysis_extraction', result.output);
    expect(gate.ok).toBe(true);
    expect((gate.data as { result_type: string }).result_type).toBe('analysis_result');
  });

  it.each(['project_candidates', 'brief_generation', 'understanding_review', 'training_response', 'training_feedback'])(
    'passes the schema gate for taskType=%s',
    async (taskType) => {
      const result = await provider.invoke({ taskType, payload: {} });
      const gate = validateOutput(taskType, result.output);
      expect(gate.ok).toBe(true);
    },
  );

  it('records a stable error code on schema-gate failure', () => {
    const gate = validateOutput('domain_profile', { wrong: 'shape' });
    expect(gate.ok).toBe(false);
    expect(gate.error).toBeDefined();
    expect(SCHEMA_GATE_ERROR_CODE).toBe('SCHEMA_GATE_FAILED');
  });

  it('lets unknown taskTypes pass through the gate', () => {
    const gate = validateOutput('unknown_future_task', { anything: true });
    expect(gate.ok).toBe(true);
  });

  it('exposes a prompt version for every supported taskType', () => {
    for (const taskType of TASK_TYPES) {
      expect(PROMPT_VERSIONS[taskType]).toBeDefined();
      expect(promptVersionFor(taskType)).toMatch(/-v\d+$/);
    }
  });

  it('falls back to a default prompt version for unknown taskTypes', () => {
    expect(promptVersionFor('does_not_exist')).toBe('unknown-v0');
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('calls chat completions and parses JSON content with usage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      choices: [
        {
          message: {
            content: JSON.stringify({
              question: '这个活动主要面向哪类新生？',
              slot: 'target_user',
              rationale: '目标用户会影响活动内容和宣传方式。',
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 45,
        total_tokens: 168,
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://router.shengsuanyun.com/api/v1/',
      apiKey: 'test-key',
      model: 'deepseek/deepseek-v4-flash',
      providerLabel: 'shengsuanyun',
      referer: 'http://localhost:3000',
      title: 'ReqClinic',
      thinking: 'disabled',
    });

    const result = await provider.invoke({
      taskType: 'quick.elicitation.next_question',
      payload: { original_input: '我想办读书分享会' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://router.shengsuanyun.com/api/v1/chat/completions');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'ReqClinic',
    });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek/deepseek-v4-flash');
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[0].role).toBe('system');

    expect(result.provider).toBe('shengsuanyun');
    expect(result.model).toBe('deepseek/deepseek-v4-flash');
    expect(result.inputTokens).toBe(123);
    expect(result.outputTokens).toBe(45);
    expect(result.output).toMatchObject({
      question: '这个活动主要面向哪类新生？',
      slot: 'target_user',
    });
  });

  it('throws a provider-scoped error on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'invalid api key' },
    }), { status: 401 })));

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://router.shengsuanyun.com/api/v1',
      apiKey: 'bad-key',
      model: 'deepseek/deepseek-v4-flash',
      providerLabel: 'shengsuanyun',
    });

    await expect(
      provider.invoke({ taskType: 'quick.elicitation.next_question', payload: {} }),
    ).rejects.toThrow('shengsuanyun request failed: 401 invalid api key');
  });

  it('enables thinking only for configured task types', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      choices: [
        {
          message: {
            content: JSON.stringify({
              views: {
                simple: '# 需求简报（概述）',
                exec: '# 需求分析详细报告',
              },
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://router.shengsuanyun.com/api/v1',
      apiKey: 'test-key',
      model: 'deepseek/deepseek-v4-flash',
      thinking: 'disabled',
      thinkingTaskTypes: ['quick.composition.brief_views'],
    });

    const result = await provider.invoke({
      taskType: 'quick.composition.brief_views',
      payload: { snapshot: {} },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(result.thinkingMode).toBe('enabled');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
    expect(result.usageEstimated).toBe(false);
  });
});
