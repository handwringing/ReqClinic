import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type {
  UUID,
  QuickSession,
  QuickSessionSourceKind,
  QuickSessionTurn,
  CoverageSlot,
  CoverageSlotName,
  CoverageSlotState,
  QuickSessionUnderstanding,
  QuickSessionUnknown,
  BriefViewType,
  BriefVersion,
  BriefView,
  BriefExport,
  BriefUsefulnessFeedback,
  TopicChangeAction,
  DeleteTask,
  PaginatedResponse,
  Project,
} from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { buildQuickDemoFixture, getQuickDemoCase, quickDemoCardTitle } from '@/lib/quick-demo-cases';

// 快速问诊 Mock（21 端点）。
// sample 案例：从快速问诊案例注册表载入预生成脚本。
// custom 案例：创建独立 Mock 会话，返回通用引导性内容。

const SLOT_DEFS: { name: CoverageSlotName; label: string }[] = [
  { name: 'expected_outcome', label: '期望成果' },
  { name: 'target_user', label: '目标用户' },
  { name: 'core_scenario', label: '核心场景' },
  { name: 'scope_boundary', label: '范围说明' },
  { name: 'completion_criteria', label: '完成标准' },
  { name: 'constraints_risks', label: '风险与约束' },
];

function accepted() {
  return { job_id: generateUUID(), status: 'accepted' as const };
}

function nowIso(): string {
  return new Date().toISOString();
}

function getMessages(store: MockSessionStore, id: string): QuickSessionTurn[] {
  return store.get<QuickSessionTurn[]>(`quick_messages:${id}`) ?? [];
}
function setMessages(store: MockSessionStore, id: string, messages: QuickSessionTurn[]): void {
  store.set(`quick_messages:${id}`, messages);
}
function getCoverage(store: MockSessionStore, id: string): CoverageSlot[] | null {
  return store.get<CoverageSlot[]>(`quick_coverage:${id}`);
}
function setCoverage(store: MockSessionStore, id: string, slots: CoverageSlot[]): void {
  store.set(`quick_coverage:${id}`, slots);
}
function getUnderstanding(store: MockSessionStore, id: string): QuickSessionUnderstanding | null {
  return store.get<QuickSessionUnderstanding>(`quick_understanding:${id}`);
}
function setUnderstanding(store: MockSessionStore, id: string, u: QuickSessionUnderstanding): void {
  store.set(`quick_understanding:${id}`, u);
}
function getUnknowns(store: MockSessionStore, id: string): QuickSessionUnknown[] {
  return store.get<QuickSessionUnknown[]>(`quick_unknowns:${id}`) ?? [];
}
function setUnknowns(store: MockSessionStore, id: string, list: QuickSessionUnknown[]): void {
  store.set(`quick_unknowns:${id}`, list);
}
function getBriefVersions(store: MockSessionStore, id: string): BriefVersion[] {
  return store.get<BriefVersion[]>(`quick_brief_versions:${id}`) ?? [];
}
function setBriefVersions(store: MockSessionStore, id: string, list: BriefVersion[]): void {
  store.set(`quick_brief_versions:${id}`, list);
}
function getBriefViews(store: MockSessionStore, id: string): Record<string, BriefView> {
  return store.get<Record<string, BriefView>>(`quick_brief_views:${id}`) ?? {};
}
function setBriefViews(store: MockSessionStore, id: string, views: Record<string, BriefView>): void {
  store.set(`quick_brief_views:${id}`, views);
}

function briefViewToMarkdown(view?: BriefView): string {
  if (!view) return '';
  const sections = view.sections ?? [];
  if (sections.length === 0) return view.content;
  return [
    view.content?.trim() || '# 需求分析详细报告',
    ...sections.map((section) => `## ${section.title}\n\n${section.content}`),
  ].join('\n\n');
}

function getDetailedReportContent(
  store: MockSessionStore,
  sessionId: string | undefined,
  version: number | undefined,
): string {
  if (!sessionId) return '';
  const views = getBriefViews(store, sessionId);
  const view =
    (version ? views[`${version}:exec`] : undefined) ??
    views.exec ??
    Object.values(views).find((item) => item.view_type === 'exec');
  return briefViewToMarkdown(view);
}

// 构建初始 coverage 槽位。
function buildCoverage(states: Record<CoverageSlotName, CoverageSlotState>): CoverageSlot[] {
  return SLOT_DEFS.map((s) => ({
    name: s.name,
    label: s.label,
    state: states[s.name] ?? 'not_started',
    is_blocking: s.name === 'expected_outcome' || s.name === 'completion_criteria',
  }));
}

// custom 案例的通用引导性数据。
function seedCustomSession(store: MockSessionStore, session: QuickSession): void {
  const id = session.id;
  setCoverage(
    store,
    id,
    buildCoverage({
      expected_outcome: 'partial',
      target_user: 'not_started',
      core_scenario: 'not_started',
      scope_boundary: 'not_started',
      completion_criteria: 'not_started',
      constraints_risks: 'not_started',
    })
  );
  setUnderstanding(store, id, {
    session_id: id,
    version: 1,
    summary: '已记录你的初步诉求，接下来将通过提问澄清期望成果与目标用户。',
    slots: { expected_outcome: session.original_input },
    coverage_slots: buildCoverage({
      expected_outcome: 'partial',
      target_user: 'not_started',
      core_scenario: 'not_started',
      scope_boundary: 'not_started',
      completion_criteria: 'not_started',
      constraints_risks: 'not_started',
    }),
  });
  setUnknowns(store, id, [
    {
      id: generateUUID(),
      session_id: id,
      question: '你希望最终交付物是什么形式？（原型 / 文档 / 可运行系统）',
      is_blocking: true,
      impact: '影响后续澄清方向与简报形态。',
      suggested_owner: '需求方',
    },
  ]);
  const turns: QuickSessionTurn[] = [
    {
      id: generateUUID(),
      session_id: id,
      role: 'user',
      content: session.original_input,
      created_at: session.created_at,
    },
    {
      id: generateUUID(),
      session_id: id,
      role: 'assistant',
      content: '收到你的诉求。为了给出更可用的简报，我会先澄清几个关键问题。',
      created_at: nowIso(),
    },
  ];
  setMessages(store, id, turns);
}

function toQuickTurn(sessionId: string, raw: any, fallbackRole: 'user' | 'assistant'): QuickSessionTurn {
  return {
    id: `${raw?.id ?? generateUUID()}-${sessionId}`,
    session_id: sessionId,
    role: raw?.role ?? fallbackRole,
    content: raw?.content ?? '',
    structured_content: raw?.structured_content,
    source_refs: raw?.source_refs,
    update_marks: raw?.update_marks,
    follow_ups: raw?.follow_ups,
    created_at: raw?.created_at ?? nowIso(),
  };
}

function storeSampleBriefs(store: MockSessionStore, sessionId: string, fx: any): void {
  const versions: any[] = fx?.brief_versions ?? [];
  if (versions.length > 0) {
    setBriefVersions(
      store,
      sessionId,
      versions.map((v: any) => ({
        version: v.version ?? 1,
        session_id: sessionId,
        generated_at: v.generated_at ?? nowIso(),
        is_incomplete: v.is_incomplete ?? false,
        blocking_unknowns_count: v.blocking_unknowns_count ?? 0,
        non_blocking_unknowns_count: v.non_blocking_unknowns_count ?? 0,
      }))
    );
  }

  const fxBriefViews: any = fx?.brief_views;
  if (fxBriefViews && typeof fxBriefViews === 'object') {
    const views: Record<string, BriefView> = {};
    for (const [key, val] of Object.entries(fxBriefViews)) {
      if (!val) continue;
      const v = val as any;
      const view: BriefView = {
        view_type: (v.view_type ?? key) as BriefViewType,
        brief_version: v.brief_version ?? 1,
        content: v.content ?? '',
        sections: v.sections,
      };
      views[key] = view;
      views[`${view.brief_version}:${key}`] = view;
    }
    setBriefViews(store, sessionId, views);
  }
}

function buildCurrentSampleFixture(store: MockSessionStore, session: QuickSession): any {
  return buildQuickDemoFixture(session.source_case_id, getUnderstanding(store, session.id));
}

function completeCoverage(): CoverageSlot[] {
  return buildCoverage({
    expected_outcome: 'covered',
    target_user: 'covered',
    core_scenario: 'covered',
    scope_boundary: 'covered',
    completion_criteria: 'covered',
    constraints_risks: 'covered',
  });
}

function addResolvedSampleBrief(store: MockSessionStore, sessionId: string, fx: any): number {
  const versions = getBriefVersions(store, sessionId);
  const nextVersion = Math.max(1, ...versions.map((v) => v.version)) + 1;
  const generatedAt = nowIso();
  setBriefVersions(store, sessionId, [
    ...versions,
    {
      version: nextVersion,
      session_id: sessionId,
      generated_at: generatedAt,
      is_incomplete: false,
      blocking_unknowns_count: 0,
      non_blocking_unknowns_count: 0,
    },
  ]);

  const views = getBriefViews(store, sessionId);
  const supplement = fx?.supplement;
  for (const viewType of ['simple', 'exec'] as BriefViewType[]) {
    const base =
      views[`1:${viewType}`] ??
      views[viewType] ?? {
        view_type: viewType,
        brief_version: 1,
        content: '',
      };
    const baseSections = base.sections ?? [];
    const resolvedNote = supplement?.resolvedNote ?? '关键信息已补齐，可以作为当前版本继续沟通。';
    const supplementSection =
      viewType === 'simple'
        ? { title: '补充后结论', content: resolvedNote }
        : { title: '详细报告更新', content: `- 已补齐：${resolvedNote}\n- 当前状态：可以作为当前版本继续沟通、导出或评审。` };
    const view: BriefView = {
      ...base,
      view_type: viewType,
      brief_version: nextVersion,
      content: `${base.content}\n\n补充后确认：${supplementSection.content}`,
      sections: [...baseSections, supplementSection],
    };
    views[`${nextVersion}:${viewType}`] = view;
    views[viewType] = view;
  }
  setBriefViews(store, sessionId, views);
  return nextVersion;
}

function applyUpdateMarksToUnderstanding(
  store: MockSessionStore,
  sessionId: string,
  marks?: string[],
): void {
  const validSlots = new Set(SLOT_DEFS.map((slot) => slot.name));
  const current = getUnderstanding(store, sessionId);
  const currentCoverage = getCoverage(store, sessionId) ?? buildCoverage({
    expected_outcome: 'not_started',
    target_user: 'not_started',
    core_scenario: 'not_started',
    scope_boundary: 'not_started',
    completion_criteria: 'not_started',
    constraints_risks: 'not_started',
  });
  const slots = { ...(current?.slots ?? {}) };
  const changedSlots = new Set<CoverageSlotName>();

  for (const mark of marks ?? []) {
    const [field, ...rest] = String(mark).split('=');
    const name = field.trim() as CoverageSlotName;
    const value = rest.join('=').trim();
    if (!validSlots.has(name) || !value) continue;
    slots[name] = value;
    changedSlots.add(name);
  }

  if (changedSlots.size === 0) return;

  const coverage = currentCoverage.map((slot) =>
    changedSlots.has(slot.name) ? { ...slot, state: 'covered' as CoverageSlotState } : slot
  );
  setCoverage(store, sessionId, coverage);
  setUnderstanding(store, sessionId, {
    session_id: sessionId,
    version: (current?.version ?? 1) + 1,
    summary: current?.summary ?? '当前理解已更新。',
    slots,
    coverage_slots: coverage,
  });
}

function initialSampleCoverage(): CoverageSlot[] {
  return buildCoverage({
    expected_outcome: 'partial',
    target_user: 'not_started',
    core_scenario: 'partial',
    scope_boundary: 'not_started',
    completion_criteria: 'partial',
    constraints_risks: 'not_started',
  });
}

function setSampleUnknownFromTurn(store: MockSessionStore, sessionId: string, turn?: any): void {
  if (!turn) {
    setUnknowns(store, sessionId, []);
    return;
  }
  setUnknowns(store, sessionId, [
    {
      id: `${turn.id ?? generateUUID()}-unknown-${sessionId}`,
      session_id: sessionId,
      question: turn.content ?? '待澄清问题',
      is_blocking: true,
      impact: '用于推进当前问诊脚本。',
      suggested_owner: '需求方',
    },
  ]);
}

function sampleFinalCoverage(sessionId: string, fx: any): CoverageSlot[] {
  const coverage: any[] = fx?.coverage ?? fx?.understanding?.coverage_slots ?? [];
  if (coverage.length === 0) {
    return buildCoverage({
      expected_outcome: 'covered',
      target_user: 'covered',
      core_scenario: 'covered',
      scope_boundary: 'partial',
      completion_criteria: 'partial',
      constraints_risks: 'not_started',
    });
  }
  return coverage.map((s: any) => ({
    name: s.name,
    label: s.label ?? SLOT_DEFS.find((d) => d.name === s.name)?.label ?? s.name,
    state: s.state ?? 'covered',
    is_blocking: s.is_blocking ?? false,
  })) as CoverageSlot[];
}

function setSampleProgress(
  store: MockSessionStore,
  session: QuickSession,
  completedFixtureIndex: number
): boolean {
  const fx = buildQuickDemoFixture(session.source_case_id);
  const id = session.id;
  const finalUnderstanding: any = fx?.understanding;
  const script: any[] = fx?.messages ?? [];
  const isFinal = completedFixtureIndex >= script.length - 1;

  if (isFinal && finalUnderstanding) {
    const coverage = sampleFinalCoverage(id, fx);
    setCoverage(store, id, coverage);
    setUnderstanding(store, id, {
      session_id: id,
      version: finalUnderstanding.version ?? 1,
      summary: finalUnderstanding.summary ?? '已形成当前理解。',
      slots: finalUnderstanding.slots ?? {},
      coverage_slots: coverage,
    });
    setUnknowns(
      store,
      id,
      (fx?.unknowns ?? []).map((u: any) => ({
        id: u.id ?? generateUUID(),
        session_id: id,
        question: u.question ?? '待澄清问题',
        is_blocking: u.is_blocking ?? false,
        impact: u.impact ?? '',
        suggested_owner: u.suggested_owner,
      }))
    );
    return true;
  }

  const slots: QuickSessionUnderstanding['slots'] = {
    expected_outcome: finalUnderstanding?.slots?.expected_outcome ?? session.original_input,
  };
  const states: Record<CoverageSlotName, CoverageSlotState> = {
    expected_outcome: 'partial',
    target_user: 'not_started',
    core_scenario: 'partial',
    scope_boundary: 'not_started',
    completion_criteria: 'partial',
    constraints_risks: 'not_started',
  };

  for (let i = 0; i <= completedFixtureIndex; i += 1) {
    const turn = script[i];
    if (turn?.role !== 'user') continue;
    for (const mark of turn.update_marks ?? []) {
      const [field, value] = String(mark).split('=');
      if (!field) continue;
      const name = field.trim() as CoverageSlotName;
      if (SLOT_DEFS.some((s) => s.name === name)) {
        slots[name] = finalUnderstanding?.slots?.[name] ?? value?.trim();
        states[name] = name === 'scope_boundary' || name === 'completion_criteria' ? 'partial' : 'covered';
      }
    }
  }

  const coverage = buildCoverage(states);
  setCoverage(store, id, coverage);
  setUnderstanding(store, id, {
    session_id: id,
    version: 0,
    summary: '助手正在通过连续问答逐步澄清需求，尚未进入理解确认。',
    slots,
    coverage_slots: coverage,
  });
  const nextAssistant = script.find((turn, index) => index > completedFixtureIndex && turn?.role === 'assistant');
  setSampleUnknownFromTurn(store, id, nextAssistant);
  return false;
}

function makeUnderstandingReviewTurn(sessionId: string, fx: any): QuickSessionTurn {
  const slots = fx?.understanding?.slots ?? {};
  const reviewCardTitle = quickDemoCardTitle(fx?.case_id, fx?.review?.cardId);
  return {
    id: `${generateUUID()}-understanding-review`,
    session_id: sessionId,
    role: 'assistant',
    content: `我已经把这轮问诊整理成当前理解。请点击右侧「${reviewCardTitle}」卡片加入对话框，再填入修改内容。`,
    structured_content: {
      paragraphs: [`我已经把这轮问诊整理成当前理解。请点击右侧「${reviewCardTitle}」卡片加入对话框，再填入修改内容。`],
      bullets: [
        `目标用户：${slots.target_user ?? '待确认'}`,
        `核心场景：${slots.core_scenario ?? '待确认'}`,
        `范围说明：${slots.scope_boundary ?? '待确认'}`,
      ],
      highlights: ['当前理解', reviewCardTitle, '填入修改'],
    },
    update_marks: ['understanding_review=ready'],
    created_at: nowIso(),
  };
}

function hasBoundCardContent(content: string): boolean {
  return /【[^】]+】/.test(content);
}

function makeCardReferenceAcknowledgedTurn(sessionId: string, fx: any): QuickSessionTurn {
  const resolvedNote = fx?.review?.resolvedNote ?? '已记录这张卡片的确认或调整意见。';
  return {
    id: `${generateUUID()}-card-reference`,
    session_id: sessionId,
    role: 'assistant',
    content: `${resolvedNote}现在可以继续查看方案。`,
    structured_content: {
      paragraphs: [`${resolvedNote}现在可以继续查看方案。`],
      highlights: ['已记录', '查看方案'],
    },
    update_marks: fx?.review?.updateMarks ?? ['card_reference=checked'],
    created_at: nowIso(),
  };
}

function makeOptionReviewTurn(sessionId: string, fx: any): QuickSessionTurn {
  const options: any[] = fx?.options ?? [];
  const recommended = options.find((option) => option?.is_recommended) ?? options[0];
  const recommendedTitle = recommended?.title ?? '推荐方案';
  return {
    id: `${generateUUID()}-option-review`,
    session_id: sessionId,
    role: 'assistant',
    content: `理解确认后，我把可选方案整理好了。当前推荐“${recommendedTitle}”，你可以继续生成需求简报。`,
    structured_content: {
      paragraphs: [`理解确认后，我把可选方案整理好了。当前推荐“${recommendedTitle}”。`],
      bullets:
        options.length > 0
          ? options.map((option) =>
              `${option.title}${option.is_recommended ? '（推荐）' : ''}：${option.description}`
            )
          : ['方案B：智能生成布局与文案（推荐）'],
      highlights: ['方案', '推荐', '需求简报'],
    },
    update_marks: ['option_review=ready'],
    created_at: nowIso(),
  };
}

function makeBriefReadyTurn(sessionId: string): QuickSessionTurn {
  return {
    id: `${generateUUID()}-brief-ready`,
    session_id: sessionId,
    role: 'assistant',
    content: '需求简报已生成。你可以打开简报页查看概述和详细报告。',
    structured_content: {
      paragraphs: ['需求简报已生成。'],
      bullets: ['概述', '详细报告'],
      highlights: ['需求简报'],
    },
    update_marks: ['brief_ready=version_1'],
    created_at: nowIso(),
  };
}

function makeRevisedBriefReadyTurn(sessionId: string, version: number): QuickSessionTurn {
  return {
    id: `${generateUUID()}-brief-revised`,
    session_id: sessionId,
    role: 'assistant',
    content: `补充信息已纳入，关键信息已确认。第 ${version} 版简报已生成。`,
    structured_content: {
      paragraphs: [`补充信息已纳入，关键信息已确认。第 ${version} 版简报已生成。`],
      bullets: ['可查看新版简报', '旧版未完成草稿仍保留在版本历史中'],
      highlights: ['关键信息已确认', `第 ${version} 版`],
    },
    update_marks: [`brief_ready=version_${version}`],
    created_at: nowIso(),
  };
}

// sample 案例：只展示首问，后续由引导回答按钮逐步推进。
function seedSampleSession(store: MockSessionStore, session: QuickSession): void {
  const id = session.id;
  const fx = buildQuickDemoFixture(session.source_case_id);
  const script: any[] = fx?.messages ?? [];
  const firstAssistant = script.find((turn) => turn?.role === 'assistant');
  const coverage = initialSampleCoverage();

  setCoverage(store, id, coverage);
  setUnderstanding(store, id, {
    session_id: id,
    version: 0,
    summary: `已载入${fx?.title ?? '快速问诊案例'}，助手会按当前流程逐步追问。`,
    slots: {
      expected_outcome: fx?.understanding?.slots?.expected_outcome ?? session.original_input,
    },
    coverage_slots: coverage,
  });
  setSampleUnknownFromTurn(store, id, firstAssistant);

  const turns: QuickSessionTurn[] = [
    {
      id: `${generateUUID()}-original`,
      session_id: id,
      role: 'user',
      content: session.original_input,
      created_at: session.created_at,
    },
  ];
  if (firstAssistant) {
    turns.push(toQuickTurn(id, firstAssistant, 'assistant'));
  } else {
    turns.push({
      id: `${generateUUID()}-first-question`,
      session_id: id,
      role: 'assistant',
      content: '我先确认一下：你希望生成的是网页海报，还是可下载的图片文件？',
      created_at: nowIso(),
    });
  }
  setMessages(store, id, turns);
  store.set(`quick_demo_next_turn_index:${id}`, 1);
  storeSampleBriefs(store, id, fx);
}

export function registerQuickSessionHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  // 1. createQuickSession
  registry.register(
    'createQuickSession',
    async (request: {
      original_input: string;
      source_kind?: QuickSessionSourceKind;
      source_case_id?: string;
    }) => {
      const now = nowIso();
      const sourceKind: QuickSessionSourceKind = request.source_kind ?? 'custom';
      const session: QuickSession = {
        id: generateUUID(),
        version: 1,
        status: 'clarifying',
        source_kind: sourceKind,
        source_case_id: request.source_case_id,
        original_input: request.original_input,
        current_understanding_version: 0,
        brief_version: 0,
        created_at: now,
        updated_at: now,
        estimated_purge_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      };
      store.setQuickSession(session);
      if (sourceKind === 'sample') {
        seedSampleSession(store, session);
      } else {
        seedCustomSession(store, session);
      }
      return session;
    }
  );

  // 2. getQuickSession
  registry.register('getQuickSession', async (request: { id: UUID }) => {
    const session = store.getQuickSession(request.id);
    if (!session) {
      throw new ApiClientError(404, 'NOT_FOUND', '快速问诊会话不存在', generateUUID());
    }
    return session;
  });

  // 3. deleteQuickSession
  registry.register(
    'deleteQuickSession',
    async (request: { id: UUID }) => {
      const task: DeleteTask = {
        id: generateUUID(),
        entity_type: 'quick_session',
        entity_id: request.id,
        status: 'pending',
        estimated_purge_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
      store.set(`delete_task:${task.id}`, task);
      return task;
    },
    [202]
  );

  // 4. listQuickSessionMessages
  registry.register(
    'listQuickSessionMessages',
    async (request: { id: UUID; limit?: number; offset?: number }) => {
      const messages = getMessages(store, request.id);
      const limit = request.limit ?? 50;
      const offset = request.offset ?? 0;
      const items = messages.slice(offset, offset + limit);
      return { items, total: messages.length, limit, offset } as PaginatedResponse<QuickSessionTurn>;
    }
  );

  // 5. postQuickSessionMessage（异步，next_question）
  registry.register(
    'postQuickSessionMessage',
    async (request: {
      session_id: UUID;
      content: string;
      referenced_card_ids?: UUID[];
      bound_refs?: Array<{ card_id: UUID; card_title: string; card_version?: string | null }>;
    }) => {
      const session = store.getQuickSession(request.session_id);
      const referencedCardIds =
        request.referenced_card_ids ?? request.bound_refs?.map((ref) => ref.card_id);
      if (session?.source_kind === 'sample' && getQuickDemoCase(session.source_case_id)) {
        const fx = buildQuickDemoFixture(session.source_case_id);
        const script: any[] = fx?.messages ?? [];
        const messages = getMessages(store, request.session_id);

        if (session.status === 'understanding_review' && hasBoundCardContent(request.content)) {
          applyUpdateMarksToUnderstanding(store, request.session_id, fx?.review?.updateMarks);
          messages.push({
            id: generateUUID(),
            session_id: request.session_id,
            role: 'user',
            content: request.content,
            referenced_card_ids: referencedCardIds,
            created_at: nowIso(),
          });
          messages.push(makeCardReferenceAcknowledgedTurn(request.session_id, fx));
          setMessages(store, request.session_id, messages);
          store.setQuickSession({
            ...session,
            current_understanding_version: (getUnderstanding(store, request.session_id)?.version ?? session.current_understanding_version),
            updated_at: nowIso(),
          });
          return accepted();
        }

        if (session.status === 'brief_ready' && hasBoundCardContent(request.content)) {
          const coverage = completeCoverage();
          const nextVersion = addResolvedSampleBrief(store, request.session_id, fx);
          messages.push({
            id: generateUUID(),
            session_id: request.session_id,
            role: 'user',
            content: request.content,
            referenced_card_ids: referencedCardIds,
            created_at: nowIso(),
          });
          messages.push(makeRevisedBriefReadyTurn(request.session_id, nextVersion));
          setMessages(store, request.session_id, messages);
          setCoverage(store, request.session_id, coverage);
          setUnderstanding(store, request.session_id, {
            session_id: request.session_id,
            version: nextVersion,
            summary: fx?.understanding?.summary ?? '关键信息已补齐，当前理解可继续用于沟通。',
            slots: fx?.understanding?.slots ?? {},
            coverage_slots: coverage,
          });
          setUnknowns(store, request.session_id, []);
          store.setQuickSession({
            ...session,
            brief_version: nextVersion,
            current_understanding_version: nextVersion,
            updated_at: nowIso(),
          });
          return accepted();
        }

        const nextIndex =
          store.get<number>(`quick_demo_next_turn_index:${request.session_id}`) ?? 1;
        const expectedUserTurn = script[nextIndex];

        if (expectedUserTurn?.role === 'user') {
          messages.push({
            ...toQuickTurn(request.session_id, expectedUserTurn, 'user'),
            content: request.content,
            referenced_card_ids: referencedCardIds,
          });
        } else {
          messages.push({
            id: generateUUID(),
            session_id: request.session_id,
            role: 'user',
            content: request.content,
            referenced_card_ids: referencedCardIds,
            created_at: nowIso(),
          });
        }

        const nextAssistantTurn = script[nextIndex + 1];
        if (nextAssistantTurn?.role === 'assistant') {
          messages.push(toQuickTurn(request.session_id, nextAssistantTurn, 'assistant'));
          store.set(`quick_demo_next_turn_index:${request.session_id}`, nextIndex + 2);
        } else {
          messages.push(makeUnderstandingReviewTurn(request.session_id, fx));
          store.set(`quick_demo_next_turn_index:${request.session_id}`, script.length);
        }

        const reachedReview = setSampleProgress(store, session, nextIndex);
        setMessages(store, request.session_id, messages);
        store.setQuickSession({
          ...session,
          status: reachedReview ? 'understanding_review' : 'clarifying',
          current_understanding_version: reachedReview ? fx?.understanding?.version ?? 1 : 0,
          updated_at: nowIso(),
        });
        return accepted();
      }

      // 持久化自定义用户消息，使 listQuickSessionMessages 可恢复。
      const messages = getMessages(store, request.session_id);
      messages.push({
        id: generateUUID(),
        session_id: request.session_id,
        role: 'user',
        content: request.content,
        referenced_card_ids: referencedCardIds,
        created_at: nowIso(),
      });
      setMessages(store, request.session_id, messages);
      // 更新会话时间戳。
      if (session) {
        store.setQuickSession({ ...session, updated_at: nowIso() });
      }
      return accepted();
    }
  );

  // 6. getQuickSessionCoverage
  registry.register('getQuickSessionCoverage', async (request: { session_id: UUID }) => {
    const slots = getCoverage(store, request.session_id);
    if (slots) return slots;
    // 回退：全 not_started。
    return buildCoverage({
      expected_outcome: 'not_started',
      target_user: 'not_started',
      core_scenario: 'not_started',
      scope_boundary: 'not_started',
      completion_criteria: 'not_started',
      constraints_risks: 'not_started',
    });
  });

  // 7. getQuickSessionUnderstanding
  registry.register('getQuickSessionUnderstanding', async (request: { session_id: UUID }) => {
    const u = getUnderstanding(store, request.session_id);
    if (u) return u;
    return {
      session_id: request.session_id,
      version: 0,
      summary: '尚未生成理解摘要。',
      slots: {},
      coverage_slots: buildCoverage({
        expected_outcome: 'not_started',
        target_user: 'not_started',
        core_scenario: 'not_started',
        scope_boundary: 'not_started',
        completion_criteria: 'not_started',
        constraints_risks: 'not_started',
      }),
    } as QuickSessionUnderstanding;
  });

  // 8. listQuickSessionUnknowns
  registry.register('listQuickSessionUnknowns', async (request: { session_id: UUID }) => {
    return getUnknowns(store, request.session_id);
  });

  // 9. reviewQuickSessionUnderstanding（异步，understanding_updated）
  registry.register(
    'reviewQuickSessionUnderstanding',
    async (request: { session_id: UUID; action: string }) => {
      const session = store.getQuickSession(request.session_id);
      if (!session) {
        throw new ApiClientError(404, 'NOT_FOUND', '快速问诊会话不存在', generateUUID());
      }
      if (request.action === 'accept' || request.action === 'modify') {
        const fx = buildQuickDemoFixture(session.source_case_id);
        const messages = getMessages(store, request.session_id);
        messages.push(makeOptionReviewTurn(request.session_id, fx));
        setMessages(store, request.session_id, messages);
        store.setQuickSession({
          ...session,
          status: 'option_review',
          updated_at: nowIso(),
        });
      }
      return accepted();
    }
  );

  // 10. handleQuickSessionTopicChange
  registry.register(
    'handleQuickSessionTopicChange',
    async (request: { session_id: UUID; new_input: string; action: TopicChangeAction }) => {
      const session = store.getQuickSession(request.session_id);
      if (!session) {
        throw new ApiClientError(404, 'NOT_FOUND', '快速问诊会话不存在', generateUUID());
      }
      if (request.action === 'append') {
        const messages = getMessages(store, request.session_id);
        messages.push({
          id: generateUUID(),
          session_id: request.session_id,
          role: 'user',
          content: request.new_input,
          created_at: nowIso(),
        });
        setMessages(store, request.session_id, messages);
      }
      const updated: QuickSession = {
        ...session,
        updated_at: nowIso(),
      };
      store.setQuickSession(updated);
      return { handled: true, action: request.action, session: updated };
    }
  );

  // 11. recordQuickSessionOptionPreference（异步，option_comparison）
  registry.register(
    'recordQuickSessionOptionPreference',
    async (request: { session_id: UUID; option_id: UUID; is_preferred: boolean }) => {
      const session = store.getQuickSession(request.session_id);
      if (!session) {
        throw new ApiClientError(404, 'NOT_FOUND', '快速问诊会话不存在', generateUUID());
      }
      const messages = getMessages(store, request.session_id);
      if (session.source_kind === 'sample' && getQuickDemoCase(session.source_case_id)) {
        storeSampleBriefs(store, request.session_id, buildCurrentSampleFixture(store, session));
      }
      messages.push(makeBriefReadyTurn(request.session_id));
      setMessages(store, request.session_id, messages);
      store.setQuickSession({
        ...session,
        status: 'brief_ready',
        brief_version: 1,
        updated_at: nowIso(),
      });
      return accepted();
    }
  );

  // 12. listQuickSessionBriefVersions
  registry.register('listQuickSessionBriefVersions', async (request: { session_id: UUID }) => {
    return getBriefVersions(store, request.session_id);
  });

  // 13. generateQuickSessionBrief（异步，brief_version）
  registry.register(
    'generateQuickSessionBrief',
    async (request: { session_id: UUID }) => {
      const session = store.getQuickSession(request.session_id);
      if (session) {
        if (session.source_kind === 'sample' && getQuickDemoCase(session.source_case_id)) {
          storeSampleBriefs(store, request.session_id, buildCurrentSampleFixture(store, session));
        }
        store.setQuickSession({
          ...session,
          status: 'brief_ready',
          brief_version: 1,
          updated_at: nowIso(),
        });
      }
      return accepted();
    }
  );

  // 14. getQuickSessionBriefVersion
  registry.register(
    'getQuickSessionBriefVersion',
    async (request: { session_id: UUID; version: number }) => {
      const versions = getBriefVersions(store, request.session_id);
      const found = versions.find((v) => v.version === request.version);
      if (found) return found;
      // 回退：构造一个临时版本。
      return {
        version: request.version,
        session_id: request.session_id,
        generated_at: nowIso(),
        is_incomplete: false,
        blocking_unknowns_count: 0,
        non_blocking_unknowns_count: 0,
      } as BriefVersion;
    }
  );

  // 15. getBriefView
  registry.register(
    'getBriefView',
    async (request: { session_id: UUID; brief_version: number; view_type: BriefViewType }) => {
      const views = getBriefViews(store, request.session_id);
      const existing = views[`${request.brief_version}:${request.view_type}`] ?? views[request.view_type];
      if (existing) return existing;
      // 生成默认视图。
      const contentByType: Record<BriefViewType, string> = {
        simple: '# 需求简报（概述）\n\n本简报基于快速问诊澄清结果生成，包含目标、用户、场景与完成标准。',
        exec: '# 需求分析详细报告\n\n面向导出、评审和后续协作：包含目标、用户、场景、范围、完成标准、风险、方案取舍和待确认事项。',
      };
      return {
        view_type: request.view_type,
        brief_version: request.brief_version,
        content: contentByType[request.view_type] ?? contentByType.simple,
      } as BriefView;
    }
  );

  // 16. exportQuickSessionBrief
  registry.register(
    'exportQuickSessionBrief',
    async (request: { session_id: UUID; brief_version: number; formats: string[] }) => {
      const exportId = generateUUID();
      const briefExport: BriefExport = {
        export_id: exportId,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        formats: request.formats,
      };
      store.set(`quick_export:${exportId}`, briefExport);
      store.set(`quick_export_meta:${exportId}`, {
        session_id: request.session_id,
        brief_version: request.brief_version,
      });
      return briefExport;
    }
  );

  // 17. downloadQuickSessionBrief
  registry.register('downloadQuickSessionBrief', async (request: { export_id: UUID; format: string }) => {
    const meta = store.get<{ session_id?: string; brief_version?: number }>(
      `quick_export_meta:${request.export_id}`,
    );
    const reportContent = getDetailedReportContent(store, meta?.session_id, meta?.brief_version);
    const content =
      reportContent ||
      `# 需求分析详细报告\n\n格式：${request.format === 'pdf' ? '版式文件' : '文本文件'}\n导出编号：${request.export_id}\n由本地预览生成。`;
    const encoded =
      typeof btoa !== 'undefined'
        ? btoa(unescape(encodeURIComponent(content)))
        : Buffer.from(content).toString('base64');
    return { download_url: `data:text/plain;charset=utf-8;base64,${encoded}` };
  });

  // 18. submitBriefUsefulnessFeedback
  registry.register(
    'submitBriefUsefulnessFeedback',
    async (request: { session_id: UUID; brief_version: number; feedback: BriefUsefulnessFeedback }) => {
      const list =
        store.get<Array<{ session_id: string; brief_version: number; feedback: BriefUsefulnessFeedback }>>(
          'brief_feedbacks'
        ) ?? [];
      list.push({
        session_id: request.session_id,
        brief_version: request.brief_version,
        feedback: request.feedback,
      });
      store.set('brief_feedbacks', list);
      return { received: true };
    }
  );

  // 19. abandonQuickSession
  registry.register('abandonQuickSession', async (request: { id: UUID }) => {
    const session = store.getQuickSession(request.id);
    if (!session) {
      throw new ApiClientError(404, 'NOT_FOUND', '快速问诊会话不存在', generateUUID());
    }
    const updated: QuickSession = { ...session, status: 'archived', updated_at: nowIso() };
    store.setQuickSession(updated);
    return updated;
  });

  // 20. archiveQuickSession
  registry.register('archiveQuickSession', async (request: { id: UUID }) => {
    const session = store.getQuickSession(request.id);
    if (!session) {
      throw new ApiClientError(404, 'NOT_FOUND', '快速问诊会话不存在', generateUUID());
    }
    const updated: QuickSession = { ...session, status: 'archived', updated_at: nowIso() };
    store.setQuickSession(updated);
    return updated;
  });

  // 21. upgradeQuickSession
  registry.register(
    'upgradeQuickSession',
    async (request: { session_id: UUID; title: string }) => {
      const session = store.getQuickSession(request.session_id);
      const now = nowIso();
      const projectId = generateUUID();
      if (session) {
        const updated: QuickSession = { ...session, status: 'upgraded', updated_at: nowIso() };
        store.setQuickSession(updated);
      }
      const projects = store.get<Record<string, Project>>('projects') ?? {};
      projects[projectId] = {
        id: projectId,
        title: request.title,
        status: 'reviewing',
        source_kind: session?.source_kind === 'sample' ? 'sample' : 'quick_upgrade',
        source_case_id: session?.source_case_id ?? null,
        version: 1,
        created_by: '00000000-0000-4000-8000-000000000099',
        created_at: now,
        updated_at: now,
      };
      store.set('projects', projects);
      return { job_id: projectId, status: 'accepted' as const, project_id: projectId, upgraded: true, title: request.title };
    }
  );
}
