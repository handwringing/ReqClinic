import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type {
  UUID,
  Project,
  ProjectMember,
  DeleteTask,
  AiJob,
  FormalMapData,
  FormalMapMessage,
  FormalMapResponse,
} from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { getQuickDemoCase } from '@/lib/quick-demo-cases';
import { asterFixture } from './_fixtures';
import {
  FORMAL_CUSTOM_PROJECT_ID,
  FORMAL_STATIC_CASE_IDS,
  formalQuickUpgradeProjectId,
  formalStaticProjectId,
  staticFormalProjectSourceCase,
} from '@/lib/static-demo-ids';

// 正式项目 Mock：创建（异步）、读取、更新、删除、成员管理。

const ASTER_PROJECT_ID = '00000000-0000-4000-8000-000000000100';

const FORMAL_SAMPLE_TITLES: Record<string, string> = {
  aster: '园区访客预约与通行',
  outsourcing: '企业官网外包采购',
  capstone: '智能面试助手毕业设计',
};

function getProjects(store: MockSessionStore): Record<string, Project> {
  return store.get<Record<string, Project>>('projects') ?? {};
}

function setProjects(store: MockSessionStore, projects: Record<string, Project>): void {
  store.set('projects', projects);
}

function getDeleteTasks(store: MockSessionStore): Record<string, DeleteTask> {
  return store.get<Record<string, DeleteTask>>('delete_tasks') ?? {};
}

function setDeleteTasks(store: MockSessionStore, tasks: Record<string, DeleteTask>): void {
  store.set('delete_tasks', tasks);
}

function getMembers(store: MockSessionStore): Record<string, ProjectMember[]> {
  return store.get<Record<string, ProjectMember[]>>('members') ?? {};
}

function setMembers(store: MockSessionStore, members: Record<string, ProjectMember[]>): void {
  store.set('members', members);
}

function getFormalMapMessages(store: MockSessionStore, projectId: string): FormalMapMessage[] {
  return store.get<FormalMapMessage[]>(`formal_map_messages:${projectId}`) ?? [];
}

function setFormalMapMessages(store: MockSessionStore, projectId: string, messages: FormalMapMessage[]): void {
  store.set(`formal_map_messages:${projectId}`, messages);
}

function asterProject(): Project | null {
  const fx = asterFixture();
  if (!fx?.project) return null;
  return {
    id: ASTER_PROJECT_ID,
    title: fx.project.title ?? 'Aster 访客通行',
    status: fx.project.status ?? 'baselined',
    source_kind: 'sample',
    source_case_id: 'aster',
    version: fx.project.version ?? 1,
    created_by: fx.project.created_by ?? '00000000-0000-4000-8000-000000000099',
    created_at: fx.project.created_at ?? '2026-06-01T00:00:00.000Z',
    updated_at: fx.project.updated_at ?? '2026-06-20T00:00:00.000Z',
  };
}

function staticProject(projectId: string): Project | null {
  const sourceCaseId = staticFormalProjectSourceCase(projectId);
  const now = '2026-07-07T00:00:00.000Z';
  if (sourceCaseId) {
    const upgradedCase = getQuickDemoCase(sourceCaseId);
    return {
      id: projectId,
      title: FORMAL_SAMPLE_TITLES[sourceCaseId] ?? upgradedCase?.title ?? '正式项目示例',
      status: 'reviewing',
      source_kind: projectId.startsWith('formal-upgrade-') ? 'quick_upgrade' : 'sample',
      source_case_id: sourceCaseId,
      version: 1,
      created_by: '00000000-0000-4000-8000-000000000099',
      created_at: now,
      updated_at: now,
    };
  }
  if (projectId === FORMAL_CUSTOM_PROJECT_ID) {
    return {
      id: projectId,
      title: '自定义项目示例',
      status: 'reviewing',
      source_kind: 'custom',
      source_case_id: null,
      version: 1,
      created_by: '00000000-0000-4000-8000-000000000099',
      created_at: now,
      updated_at: now,
    };
  }
  return null;
}

function resolveProject(store: MockSessionStore, projectId: string): Project | null {
  const projects = getProjects(store);
  const found = projects[projectId];
  if (found) return found;
  if (projectId === ASTER_PROJECT_ID) return asterProject();
  return staticProject(projectId);
}

function buildMockFormalMap(project: Project): FormalMapData {
  const title = project.title || '正式项目示例';
  const sourceContext =
    project.source_kind === 'quick_upgrade'
      ? '来自快速问诊升级，已保留示例回答作为初始上下文'
      : project.source_kind === 'sample'
        ? '来自参考案例，使用 mock 数据演示正式项目问诊'
        : '来自自定义项目，使用 mock 数据演示正式项目问诊';
  const modules: FormalMapData['modules'] = [
    {
      id: 'goal',
      title: '目标与成功标准',
      status: '正在梳理',
      summary: '先把项目要解决的问题、验收口径和决策人说清楚。',
      known: [`项目名称：${title}`],
      assumptions: ['目前仍需要确认最关键的业务目标和验收优先级。'],
      questions: ['这个项目最终由谁确认目标和成功标准？'],
      relatedModuleIds: ['scope', 'roles'],
    },
    {
      id: 'scope',
      title: '首版范围与边界',
      status: '有方案可选',
      summary: '把首版必须交付、可以后置和明确不做的内容拆开。',
      known: ['已进入正式项目整理阶段。'],
      assumptions: ['首版应优先覆盖能验证核心价值的闭环。'],
      questions: ['哪些能力必须首版上线，哪些可以放到下一版？'],
      options: [
        {
          id: 'scope_core',
          title: '核心闭环优先',
          fit: '适合先验证关键流程和交付可行性。',
          tradeoff: '部分扩展体验需要后续补齐。',
          recommended: true,
        },
        {
          id: 'scope_complete',
          title: '一次性铺满',
          fit: '适合预算和周期都比较充足的项目。',
          tradeoff: '首版范围和验收压力会明显增加。',
        },
      ],
      relatedModuleIds: ['goal', 'risk'],
    },
    {
      id: 'roles',
      title: '角色与责任',
      status: '建议确认',
      summary: '明确谁使用、谁审核、谁维护，以及异常情况由谁处理。',
      known: ['正式项目需要沉淀可追踪的责任边界。'],
      assumptions: ['使用者、审核者和管理员可能不是同一类人。'],
      questions: ['普通使用者、管理员和项目负责人分别负责什么？'],
      relatedModuleIds: ['goal', 'risk'],
    },
    {
      id: 'risk',
      title: '风险与兜底',
      status: '待补充',
      summary: '提前暴露周期、数据、权限、验收争议等不确定项。',
      known: ['未确认项不应直接写成最终承诺。'],
      assumptions: ['需要为接口、数据或人员变动准备兜底方案。'],
      questions: ['如果关键依赖延期，首版保底交付是什么？'],
      relatedModuleIds: ['scope', 'report'],
    },
    {
      id: 'report',
      title: '报告与版本',
      status: '已整理',
      summary: '把当前结论、待确认项和下一步动作投射到需求报告。',
      known: ['报告需要区分已明确、假设和待确认。'],
      assumptions: ['每次确认后都应更新地图和报告草稿。'],
      questions: ['报告面向谁审阅，是否需要单独的技术版本？'],
      relatedModuleIds: ['goal', 'risk'],
    },
  ];
  return {
    result_type: 'formal_map_snapshot',
    title: `${title}需求地图`,
    summary: `${title}已进入正式项目问诊。当前最需要先确认目标责任人与验收成功标准。`,
    projectType: 'formal_project',
    sourceContext,
    currentModuleId: 'goal',
    nextQuestion: modules[0]?.questions[0] ?? '请先补充最关键的验收标准。',
    generationSteps: [
      { label: '读取项目上下文', state: 'done' },
      { label: '生成需求地图', state: 'done' },
      { label: '提出第一轮追问', state: 'active' },
    ],
    modules,
    unresolvedItems: modules.flatMap((module) =>
      module.questions.map((question) => ({
        id: `${module.id}_q`,
        label: module.title,
        detail: question,
        impact: module.id === 'goal' ? '影响验收标准和后续范围判断' : '影响正式报告的完整度',
      }))
    ),
    reportProjection: {
      overview: `${title}已经形成初版需求地图，下一步应围绕目标、范围、角色和风险逐项确认。`,
      detailedReport: [
        `# ${title}需求报告草稿`,
        '',
        '## 当前结论',
        '- 已完成正式项目地图初始化。',
        '- 当前优先追问目标确认人与成功标准。',
        '',
        '## 待确认问题',
        ...modules.map((module) => `- ${module.title}：${module.questions[0] ?? '暂无'}`),
      ].join('\n'),
    },
    qualityNotes: ['mock 正式问诊会保留 AI 提问、用户回答和报告投射，便于验证完整流程。'],
  };
}

function buildFormalMapResponse(store: MockSessionStore, project: Project): FormalMapResponse {
  const map = buildMockFormalMap(project);
  let messages = getFormalMapMessages(store, project.id);
  if (messages.length === 0) {
    messages = [
      {
        id: generateUUID(),
        project_id: project.id,
        role: 'assistant',
        content: `问诊助手先问：${map.nextQuestion}`,
        message_type: 'question',
        bound_refs: [{ id: map.currentModuleId, title: '目标与成功标准', kind: 'map_node' }],
        created_at: new Date().toISOString(),
      },
    ];
    setFormalMapMessages(store, project.id, messages);
  }
  return {
    project_id: project.id,
    active_job_id: null,
    snapshot: {
      id: generateUUID(),
      project_id: project.id,
      version: Math.max(1, project.version),
      status: 'ready',
      source_kind: project.source_kind === 'quick_upgrade' ? 'quick_upgrade' : 'fallback',
      created_at: project.updated_at,
      data: map,
    },
    messages,
  };
}

export function registerProjectHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register('createProject', async (request: {
    title: string;
    description?: string;
    source_kind?: Project['source_kind'];
    source_case_id?: string | null;
  }) => {
    // 创建并持久化新项目，返回 202 + job_id（符合异步创建契约）。
    const now = new Date().toISOString();
    const projectId =
      request.source_kind === 'sample' && request.source_case_id
        ? formalStaticProjectId(request.source_case_id)
        : request.source_kind === 'quick_upgrade' && request.source_case_id
          ? formalQuickUpgradeProjectId(request.source_case_id)
        : FORMAL_CUSTOM_PROJECT_ID;
    const project: Project = {
      id: projectId,
      title: request.title,
      status: 'draft',
      description: request.description ?? null,
      source_kind: request.source_kind ?? 'custom',
      source_case_id: request.source_case_id ?? null,
      version: 1,
      created_by: '00000000-0000-4000-8000-000000000099',
      created_at: now,
      updated_at: now,
    };
    const projects = getProjects(store);
    projects[projectId] = project;
    setProjects(store, projects);
    // 本地展示环境无后台 job 结果读取页，直接把新项目 id 作为可跳转句柄返回。
    store.set(`job_project:${projectId}`, { project_id: projectId });
    return { job_id: projectId, status: 'accepted' as const };
  });

  registry.register('getProject', async (request: { id: UUID }) => {
    const project = resolveProject(store, request.id);
    if (project) return project;
    throw new ApiClientError(404, 'NOT_FOUND', '项目不存在', generateUUID());
  });

  registry.register('getFormalMapSnapshot', async (request: { project_id: UUID }) => {
    const project = resolveProject(store, request.project_id);
    if (!project) {
      throw new ApiClientError(404, 'NOT_FOUND', '项目不存在', generateUUID());
    }
    return buildFormalMapResponse(store, project);
  });

  registry.register(
    'postFormalProjectMessage',
    async (request: {
      project_id: UUID;
      content: string;
      bound_refs?: FormalMapMessage['bound_refs'];
    }) => {
      const project = resolveProject(store, request.project_id);
      if (!project) {
        throw new ApiClientError(404, 'NOT_FOUND', '项目不存在', generateUUID());
      }
      const map = buildMockFormalMap(project);
      const now = new Date().toISOString();
      const currentMessages = getFormalMapMessages(store, project.id);
      const nextMessages: FormalMapMessage[] = [
        ...currentMessages,
        {
          id: generateUUID(),
          project_id: project.id,
          role: 'user',
          content: request.content,
          message_type: 'answer',
          bound_refs: request.bound_refs ?? [],
          created_at: now,
        },
        {
          id: generateUUID(),
          project_id: project.id,
          role: 'assistant',
          content: `已记录。下一步先确认：${map.nextQuestion}`,
          message_type: 'question',
          bound_refs: [{ id: map.currentModuleId, title: '目标与成功标准', kind: 'map_node' }],
          created_at: now,
        },
      ];
      setFormalMapMessages(store, project.id, nextMessages);
      return { job_id: generateUUID(), status: 'accepted' as const };
    },
    [202]
  );

  registry.register(
    'updateProject',
    async (request: { id: UUID; title?: string; status?: Project['status']; expected_version: number }) => {
      const projects = getProjects(store);
      const current = projects[request.id];
      if (!current) {
        throw new ApiClientError(404, 'NOT_FOUND', '项目不存在', generateUUID());
      }
      if (current.version !== request.expected_version) {
        throw new ApiClientError(409, 'VERSION_CONFLICT', '项目版本冲突', generateUUID());
      }
      const updated: Project = {
        ...current,
        title: request.title ?? current.title,
        status: request.status ?? current.status,
        version: current.version + 1,
        updated_at: new Date().toISOString(),
      };
      projects[request.id] = updated;
      setProjects(store, projects);
      return updated;
    }
  );

  registry.register(
    'deleteProject',
    async (request: { id: UUID }) => {
      const task: DeleteTask = {
        id: generateUUID(),
        entity_type: 'project',
        entity_id: request.id,
        status: 'pending',
        estimated_purge_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const tasks = getDeleteTasks(store);
      tasks[task.id] = task;
      setDeleteTasks(store, tasks);
      return task;
    },
    [202]
  );

  registry.register('getDeleteTask', async (request: { id: UUID }) => {
    const tasks = getDeleteTasks(store);
    const task = tasks[request.id];
    if (!task) {
      throw new ApiClientError(404, 'NOT_FOUND', '删除任务不存在', generateUUID());
    }
    // 推进状态以模拟后台处理。
    if (task.status === 'pending') {
      task.status = 'completed';
    }
    return task;
  });

  registry.register('createIntake', async () => {
    return { job_id: generateUUID(), status: 'accepted' as const };
  });

  registry.register('listMembers', async (request: { project_id: UUID }) => {
    const all = getMembers(store);
    const existing = all[request.project_id];
    if (existing && existing.length > 0) return existing;
    // 回退到 Aster fixture 成员。
    const fx = asterFixture();
    const fxMembers: any[] = fx?.members ?? [];
    return fxMembers.map(
      (m: any): ProjectMember => ({
        id: m.id ?? generateUUID(),
        project_id: request.project_id,
        user_id: m.user_id ?? generateUUID(),
        display_name: m.display_name ?? '成员',
        role: m.role ?? 'analyst',
        initials: m.initials ?? 'M',
      })
    );
  });

  registry.register(
    'addMember',
    async (request: {
      project_id: UUID;
      user_id: UUID;
      role: 'owner' | 'analyst' | 'reviewer' | 'observer';
      display_name: string;
    }) => {
      const member: ProjectMember = {
        id: generateUUID(),
        project_id: request.project_id,
        user_id: request.user_id,
        display_name: request.display_name,
        role: request.role,
        initials: request.display_name.slice(0, 2).toUpperCase(),
      };
      const all = getMembers(store);
      const list = all[request.project_id] ?? [];
      list.push(member);
      all[request.project_id] = list;
      setMembers(store, all);
      return member;
    }
  );

  registry.register(
    'updateMember',
    async (request: {
      project_id: UUID;
      member_id: UUID;
      role?: 'owner' | 'analyst' | 'reviewer' | 'observer';
      display_name?: string;
    }) => {
      const all = getMembers(store);
      const list = all[request.project_id] ?? [];
      const idx = list.findIndex((m) => m.id === request.member_id);
      if (idx < 0) {
        throw new ApiClientError(404, 'NOT_FOUND', '成员不存在', generateUUID());
      }
      list[idx] = {
        ...list[idx],
        role: request.role ?? list[idx].role,
        display_name: request.display_name ?? list[idx].display_name,
        initials:
          request.display_name?.slice(0, 2).toUpperCase() ?? list[idx].initials,
      };
      all[request.project_id] = list;
      setMembers(store, all);
      return list[idx];
    }
  );

  // 暴露 Aster 项目 ID 以便其他 handler 复用。
  void ASTER_PROJECT_ID as unknown as AiJob;
}
