import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID, Project, ProjectMember, DeleteTask, AiJob } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { getQuickDemoCase } from '@/lib/quick-demo-cases';
import { asterFixture } from './_fixtures';
import {
  FORMAL_CUSTOM_PROJECT_ID,
  FORMAL_STATIC_CASE_IDS,
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
    const projects = getProjects(store);
    const found = projects[request.id];
    if (found) return found;
    // Aster fixture 项目。
    if (request.id === ASTER_PROJECT_ID) {
      const ap = asterProject();
      if (ap) return ap;
    }
    const staticFallback = staticProject(request.id);
    if (staticFallback) return staticFallback;
    throw new ApiClientError(404, 'NOT_FOUND', '项目不存在', generateUUID());
  });

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
