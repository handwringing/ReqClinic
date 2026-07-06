import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID, Conflict, Gate, ReviewActionRequest, ReviewActionEntity, GateType, GateReviewResponse } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { asterFixture } from './_fixtures';

// 评审与关口 Mock：实体评审（异步）、冲突列表/解决、关口评审。

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

function buildReviewEntity(
  request: ReviewActionRequest,
  entityType: string,
  entityId: UUID
): ReviewActionEntity {
  return {
    id: generateUUID(),
    entity_type: entityType,
    entity_id: entityId,
    entity_version: request.entity_version,
    action: request.action,
    reviewer_id: '00000000-0000-4000-8000-000000000099',
    reason: request.reason,
    after_value: request.after_value ?? null,
    follow_up: request.follow_up ?? null,
    created_at: new Date().toISOString(),
  };
}

export function registerReviewHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  // ===== 异步评审（OpenAPI：reviewOutcome/reviewDriver/reviewRequirement/reviewConflict）=====
  registry.register('reviewOutcome', async (request: ReviewActionRequest & { id: UUID }) => {
    return buildReviewEntity(request, 'outcome', request.id);
  });
  registry.register('reviewDriver', async (request: ReviewActionRequest & { id: UUID }) => {
    return buildReviewEntity(request, 'driver', request.id);
  });
  registry.register('reviewRequirement', async (request: ReviewActionRequest & { id: UUID }) => {
    return buildReviewEntity(request, 'requirement', request.id);
  });

  // ===== 冲突 =====
  registry.register('listConflicts', async (request: { project_id: UUID }) => {
    const local = store.get<Conflict[]>('conflicts') ?? [];
    const localForProject = local.filter((c) => c.project_id === request.project_id);
    if (localForProject.length > 0) return localForProject;
    return fxConflicts(request.project_id);
  });

  registry.register('reviewConflict', async (request: ReviewActionRequest & { id: UUID }) => {
    const list = store.get<Conflict[]>('conflicts') ?? [];
    const idx = list.findIndex((c) => c.id === request.id);
    if (idx < 0) {
      // fixture 中的冲突：构造评审记录，不更新 fixture。
      return buildReviewEntity(request, 'conflict', request.id);
    }
    if (list[idx].version !== request.entity_version) {
      throw new ApiClientError(409, 'VERSION_CONFLICT', '版本冲突', generateUUID());
    }
    list[idx] = {
      ...list[idx],
      status: request.action === 'accept' ? 'resolved' : list[idx].status,
      version: list[idx].version + 1,
    };
    store.set('conflicts', list);
    return buildReviewEntity({ ...request, entity_version: list[idx].version }, 'conflict', request.id);
  });

  registry.register(
    'resolveConflict',
    async (request: { id: UUID; chosen: string; rationale: string; expected_version: number }) => {
      const list = store.get<Conflict[]>('conflicts') ?? fxConflicts('' as UUID);
      const idx = list.findIndex((c) => c.id === request.id);
      if (idx < 0) {
        throw new ApiClientError(404, 'NOT_FOUND', '冲突不存在', generateUUID());
      }
      if (list[idx].version !== request.expected_version) {
        throw new ApiClientError(409, 'VERSION_CONFLICT', '版本冲突', generateUUID());
      }
      list[idx] = {
        ...list[idx],
        status: 'resolved',
        version: list[idx].version + 1,
        decision: {
          chosen: request.chosen,
          rationale: request.rationale,
          decided_at: new Date().toISOString(),
        },
      };
      store.set('conflicts', list);
      return list[idx];
    }
  );

  // ===== 关口评审（OpenAPI：reviewGate）=====
  registry.register(
    'reviewGate',
    async (request: ReviewActionRequest & { project_id: UUID; gate_type: GateType }) => {
      const status: Gate['status'] =
        request.action === 'accept' ? 'passed' : request.action === 'reject' ? 'failed' : 'pending';
      const list = store.get<Gate[]>('gates') ?? [];
      const idx = list.findIndex(
        (g) => g.project_id === request.project_id && g.stage === request.gate_type
      );
      let gateId: UUID;
      if (idx < 0) {
        const newGate: Gate = {
          id: generateUUID(),
          project_id: request.project_id,
          stage: request.gate_type,
          status,
          reason: request.reason,
          reviewed_at: new Date().toISOString(),
          reviewer_id: '00000000-0000-4000-8000-000000000099',
        };
        list.push(newGate);
        store.set('gates', list);
        gateId = newGate.id;
      } else {
        list[idx] = {
          ...list[idx],
          status,
          reason: request.reason,
          reviewed_at: new Date().toISOString(),
        };
        store.set('gates', list);
        gateId = list[idx].id;
      }
      const entity = buildReviewEntity(request, 'gate', gateId);
      const response: GateReviewResponse = {
        ...entity,
        gate: request.gate_type,
      };
      return response;
    }
  );
}
