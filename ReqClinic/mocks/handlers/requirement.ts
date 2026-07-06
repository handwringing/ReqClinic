import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type {
  UUID,
  Outcome,
  Driver,
  Requirement,
  RequirementTier,
  AcceptanceCriterion,
  InterviewTurn,
  Stakeholder,
  Conflict,
  VerificationArtifact,
  CreateVerificationArtifactRequest,
  OperationalSignal,
  FutureScenario,
  CreateFutureScenarioRequest,
  EvidenceLink,
  TraceLink,
  PaginatedResponse,
} from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { asterFixture } from './_fixtures';

// 需求工程核心 Mock：成果、驱动、需求、验收标准、访谈记录、利益相关方、证据/追溯链接、冲突详情、验证工件。

function getEntities<T>(store: MockSessionStore, key: string): T[] {
  return store.get<T[]>(key) ?? [];
}
function setEntities<T>(store: MockSessionStore, key: string, value: T[]): void {
  store.set(key, value);
}

function fxOutcomes(projectId: UUID): Outcome[] {
  const fx = asterFixture();
  const list: any[] = fx?.outcomes ?? [];
  return list.map(
    (o: any): Outcome => ({
      id: o.id ?? generateUUID(),
      project_id: projectId,
      code: o.code ?? 'O-1',
      title: o.title ?? '成果',
      description: o.description ?? '',
      status: o.status ?? 'confirmed',
      version: o.version ?? 1,
      owner_id: o.owner_id,
      evidence_refs: o.evidence_refs ?? [],
    })
  );
}

function fxDrivers(projectId: UUID): Driver[] {
  const fx = asterFixture();
  const list: any[] = fx?.drivers ?? [];
  return list.map(
    (d: any): Driver => ({
      id: d.id ?? generateUUID(),
      project_id: projectId,
      code: d.code ?? 'D-1',
      title: d.title ?? '驱动',
      description: d.description ?? '',
      status: d.status ?? 'confirmed',
      version: d.version ?? 1,
    })
  );
}

function fxRequirements(projectId: UUID): Requirement[] {
  const fx = asterFixture();
  const list: any[] = fx?.requirements ?? [];
  return list.map(
    (r: any): Requirement => ({
      id: r.id ?? generateUUID(),
      project_id: projectId,
      code: r.code ?? 'R-1',
      title: r.title ?? '需求',
      description: r.description ?? '',
      tier: (r.tier as RequirementTier) ?? 'now',
      status: r.status ?? 'confirmed',
      version: r.version ?? 1,
      outcome_id: r.outcome_id,
    })
  );
}

function fxAcceptanceCriteria(): AcceptanceCriterion[] {
  const fx = asterFixture();
  const list: any[] = fx?.acceptance_criteria ?? [];
  return list.map(
    (a: any): AcceptanceCriterion => ({
      id: a.id ?? generateUUID(),
      requirement_id: a.requirement_id ?? generateUUID(),
      given: a.given ?? '',
      when: a.when ?? '',
      then: a.then ?? '',
    })
  );
}

function fxInterviewTurns(projectId: UUID): InterviewTurn[] {
  const fx = asterFixture();
  const list: any[] = fx?.interview_turns ?? [];
  return list.map(
    (t: any): InterviewTurn => ({
      id: t.id ?? generateUUID(),
      project_id: projectId,
      stakeholder_id: t.stakeholder_id,
      role: t.role ?? 'interviewer',
      content: t.content ?? '',
      created_at: t.created_at ?? new Date().toISOString(),
    })
  );
}

function fxStakeholders(projectId: UUID): Stakeholder[] {
  const fx = asterFixture();
  const list: any[] = fx?.stakeholders ?? [];
  return list.map(
    (s: any): Stakeholder => ({
      id: s.id ?? generateUUID(),
      project_id: projectId,
      name: s.name ?? '利益相关方',
      type: s.type ?? 'person',
      power: s.power ?? 'medium',
      interest: s.interest ?? 'medium',
      stance: s.stance,
    })
  );
}

function fxConflicts(projectId: UUID): Conflict[] {
  const fx = asterFixture();
  const list: any[] = fx?.conflicts ?? [];
  return list.map(
    (c: any): Conflict => ({
      id: c.id ?? generateUUID(),
      project_id: projectId,
      statement: c.statement ?? '冲突描述',
      severity: c.severity ?? 'major',
      status: c.status ?? 'open',
      version: c.version ?? 1,
      parties: c.parties ?? [],
      candidates: c.candidates,
      decision: c.decision,
    })
  );
}

function paginate<T>(items: T[], limit?: number, offset?: number): PaginatedResponse<T> {
  const l = limit ?? 50;
  const o = offset ?? 0;
  return { items: items.slice(o, o + l), total: items.length, limit: l, offset: o };
}

export function registerRequirementHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  // ===== 成果 =====
  registry.register(
    'updateOutcome',
    async (request: {
      id: UUID;
      title?: string;
      description?: string;
      status?: string;
      owner_id?: UUID;
      expected_version: number;
    }) => {
      const list = getEntities<Outcome>(store, 'outcomes');
      const idx = list.findIndex((o) => o.id === request.id);
      let current: Outcome;
      if (idx < 0) {
        const fxItem = fxOutcomes('' as UUID).find((o) => o.id === request.id);
        if (!fxItem) {
          throw new ApiClientError(404, 'NOT_FOUND', '成果不存在', generateUUID());
        }
        current = fxItem;
        list.push(current);
      } else {
        current = list[idx];
      }
      if (current.version !== request.expected_version) {
        throw new ApiClientError(409, 'VERSION_CONFLICT', '版本冲突', generateUUID());
      }
      const updated: Outcome = {
        ...current,
        title: request.title ?? current.title,
        description: request.description ?? current.description,
        status: (request.status as Outcome['status']) ?? current.status,
        owner_id: request.owner_id ?? current.owner_id,
        version: current.version + 1,
      };
      const next = list.map((o) => (o.id === updated.id ? updated : o));
      setEntities(store, 'outcomes', next);
      return updated;
    }
  );

  // ===== 驱动 =====
  registry.register(
    'listDrivers',
    async (request: { project_id: UUID; limit?: number; offset?: number }) => {
      const local = getEntities<Driver>(store, 'drivers').filter((d) => d.project_id === request.project_id);
      const items = local.length > 0 ? local : fxDrivers(request.project_id);
      return paginate(items, request.limit, request.offset);
    }
  );

  registry.register(
    'createDriver',
    async (request: { project_id: UUID; code: string; title: string; description: string }) => {
      const driver: Driver = {
        id: generateUUID(),
        project_id: request.project_id,
        code: request.code,
        title: request.title,
        description: request.description,
        status: 'draft',
        version: 1,
      };
      const list = getEntities<Driver>(store, 'drivers');
      list.push(driver);
      setEntities(store, 'drivers', list);
      return driver;
    }
  );

  registry.register(
    'updateDriver',
    async (request: {
      id: UUID;
      title?: string;
      description?: string;
      status?: string;
      expected_version: number;
    }) => {
      const list = getEntities<Driver>(store, 'drivers');
      const idx = list.findIndex((d) => d.id === request.id);
      if (idx < 0) {
        throw new ApiClientError(404, 'NOT_FOUND', '驱动不存在', generateUUID());
      }
      if (list[idx].version !== request.expected_version) {
        throw new ApiClientError(409, 'VERSION_CONFLICT', '版本冲突', generateUUID());
      }
      list[idx] = {
        ...list[idx],
        title: request.title ?? list[idx].title,
        description: request.description ?? list[idx].description,
        status: (request.status as Driver['status']) ?? list[idx].status,
        version: list[idx].version + 1,
      };
      setEntities(store, 'drivers', list);
      return list[idx];
    }
  );

  // ===== 需求 =====
  registry.register(
    'listRequirements',
    async (request: { project_id: UUID; limit?: number; offset?: number; tier?: RequirementTier }) => {
      const local = getEntities<Requirement>(store, 'requirements').filter(
        (r) => r.project_id === request.project_id
      );
      let items = local.length > 0 ? local : fxRequirements(request.project_id);
      if (request.tier) items = items.filter((r) => r.tier === request.tier);
      return paginate(items, request.limit, request.offset);
    }
  );

  registry.register(
    'updateRequirement',
    async (request: {
      id: UUID;
      title?: string;
      description?: string;
      tier?: RequirementTier;
      status?: string;
      expected_version: number;
    }) => {
      const list = getEntities<Requirement>(store, 'requirements');
      const idx = list.findIndex((r) => r.id === request.id);
      if (idx < 0) {
        throw new ApiClientError(404, 'NOT_FOUND', '需求不存在', generateUUID());
      }
      if (list[idx].version !== request.expected_version) {
        throw new ApiClientError(409, 'VERSION_CONFLICT', '版本冲突', generateUUID());
      }
      list[idx] = {
        ...list[idx],
        title: request.title ?? list[idx].title,
        description: request.description ?? list[idx].description,
        tier: request.tier ?? list[idx].tier,
        status: (request.status as Requirement['status']) ?? list[idx].status,
        version: list[idx].version + 1,
      };
      setEntities(store, 'requirements', list);
      return list[idx];
    }
  );

  // ===== 验收标准 =====
  registry.register('listAcceptanceCriteria', async (request: { requirement_id: UUID }) => {
    const local = getEntities<AcceptanceCriterion>(store, 'acceptance_criteria').filter(
      (a) => a.requirement_id === request.requirement_id
    );
    if (local.length > 0) return local;
    return fxAcceptanceCriteria().filter((a) => a.requirement_id === request.requirement_id);
  });

  registry.register(
    'createAcceptanceCriterion',
    async (request: { requirement_id: UUID; given: string; when: string; then: string }) => {
      const ac: AcceptanceCriterion = {
        id: generateUUID(),
        requirement_id: request.requirement_id,
        given: request.given,
        when: request.when,
        then: request.then,
      };
      const list = getEntities<AcceptanceCriterion>(store, 'acceptance_criteria');
      list.push(ac);
      setEntities(store, 'acceptance_criteria', list);
      return ac;
    }
  );

  // ===== 验证工件（OpenAPI: createVerificationArtifact）=====
  registry.register(
    'createVerificationArtifact',
    async (request: CreateVerificationArtifactRequest & { requirement_id: UUID; project_id?: UUID }) => {
      const artifact: VerificationArtifact = {
        id: generateUUID(),
        project_id: request.project_id ?? '00000000-0000-4000-8000-000000000100',
        requirement_id: request.requirement_id,
        acceptance_criterion_id: request.acceptance_criterion_id ?? '00000000-0000-4000-8000-000000000000',
        artifact_type: request.artifact_type,
        description: request.description,
        source_id: request.source_id ?? '00000000-0000-4000-8000-000000000000',
        result: request.result,
        executed_at: request.executed_at ?? new Date().toISOString(),
        status: 'completed',
        created_at: new Date().toISOString(),
      };
      const list = getEntities<VerificationArtifact>(store, 'verification_artifacts');
      list.push(artifact);
      setEntities(store, 'verification_artifacts', list);
      return artifact;
    }
  );

  // ===== 运营信号、未来场景、证据/追溯链接（OpenAPI 契约）=====
  registry.register('listOperationalSignals', async (request: { requirement_id: UUID }) => {
    const fx = asterFixture();
    const all: any[] = fx?.operational_signals ?? [];
    const items = all.filter((s: any) => s.requirement_id === request.requirement_id);
    return items as OperationalSignal[];
  });

  registry.register('listFutureScenarios', async (request: { project_id: UUID }) => {
    const fx = asterFixture();
    const all: any[] = fx?.future_scenarios ?? [];
    const items = all.filter((s: any) => s.project_id === request.project_id);
    return items as FutureScenario[];
  });

  registry.register(
    'createFutureScenario',
    async (request: CreateFutureScenarioRequest & { project_id: UUID }) => {
      const now = new Date().toISOString();
      const scenario: FutureScenario = {
        id: generateUUID(),
        project_id: request.project_id,
        name: request.name,
        description: request.description,
        probability_class: request.probability_class ?? 'possible',
        activation_trigger: request.activation_trigger ?? '',
        leading_indicators: request.leading_indicators ?? [],
        horizon: request.horizon,
        status: 'draft',
        version: 1,
        created_at: now,
        updated_at: now,
      };
      const list = getEntities<FutureScenario>(store, 'future_scenarios');
      list.push(scenario);
      setEntities(store, 'future_scenarios', list);
      return scenario;
    }
  );

  registry.register('listEvidenceLinks', async (request: { project_id: UUID; entity_type?: string; entity_id?: UUID; limit?: number; offset?: number }) => {
    const fx = asterFixture();
    const all: any[] = fx?.evidence_links ?? [];
    let items = all.filter((l: any) => l.project_id === request.project_id);
    if (request.entity_type) items = items.filter((l: any) => l.entity_type === request.entity_type);
    if (request.entity_id) items = items.filter((l: any) => l.entity_id === request.entity_id);
    return items as EvidenceLink[];
  });

  registry.register('listTraceLinks', async (request: { project_id: UUID; from_type?: string; from_id?: UUID; to_type?: string; to_id?: UUID; limit?: number; offset?: number }) => {
    const fx = asterFixture();
    const all: any[] = fx?.trace_links ?? [];
    let items = all.filter((l: any) => l.project_id === request.project_id);
    if (request.from_type) items = items.filter((l: any) => l.from_type === request.from_type);
    if (request.from_id) items = items.filter((l: any) => l.from_id === request.from_id);
    if (request.to_type) items = items.filter((l: any) => l.to_type === request.to_type);
    if (request.to_id) items = items.filter((l: any) => l.to_id === request.to_id);
    return items as TraceLink[];
  });

  // ===== 访谈与利益相关方 =====
  registry.register('listInterviewTurns', async (request: { project_id: UUID }) => {
    return fxInterviewTurns(request.project_id);
  });

  registry.register('listStakeholders', async (request: { project_id: UUID }) => {
    return fxStakeholders(request.project_id);
  });

  // ===== 冲突详情 =====
  registry.register('getConflictDetail', async (request: { id: UUID }) => {
    const fxItem = fxConflicts('' as UUID).find((c) => c.id === request.id);
    if (fxItem) return fxItem;
    throw new ApiClientError(404, 'NOT_FOUND', '冲突不存在', generateUUID());
  });
}
