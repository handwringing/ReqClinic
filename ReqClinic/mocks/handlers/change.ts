import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID, ChangePreview, Change } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';

// 变化管理 Mock：变更预览、影响、创建、确认、撤回。

function getPreviews(store: MockSessionStore): ChangePreview[] {
  return store.get<ChangePreview[]>('change_previews') ?? [];
}
function setPreviews(store: MockSessionStore, previews: ChangePreview[]): void {
  store.set('change_previews', previews);
}

function getChanges(store: MockSessionStore): Change[] {
  return store.get<Change[]>('changes') ?? [];
}
function setChanges(store: MockSessionStore, changes: Change[]): void {
  store.set('changes', changes);
}

function defaultImpact() {
  return [
    {
      entity_type: 'requirement' as const,
      entity_id: generateUUID(),
      impact_type: 'modified' as const,
      severity: 'major' as const,
      recommended_action: '复核相关需求是否仍归属当前成果',
    },
  ];
}

export function registerChangeHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register(
    'createChangePreview',
    async (request: { project_id: UUID; baseline_id: UUID; scenario: { type: string; description: string; affected_entities?: unknown[]; proposed_changes?: unknown } }) => {
      const preview: ChangePreview = {
        id: generateUUID(),
        project_id: request.project_id,
        description: request.scenario.description,
        trigger_reason: request.scenario.type,
        impact: defaultImpact(),
        created_at: new Date().toISOString(),
      };
      const previews = getPreviews(store);
      previews.push(preview);
      setPreviews(store, previews);
      return preview;
    }
  );

  registry.register('getChangePreviewImpact', async (request: { id: UUID }) => {
    const preview = getPreviews(store).find((p) => p.id === request.id);
    if (!preview) {
      throw new ApiClientError(404, 'NOT_FOUND', '变更预览不存在', generateUUID());
    }
    return preview.impact;
  });

  registry.register('listChanges', async (request: { project_id: UUID }) => {
    return getChanges(store).filter((c) => c.project_id === request.project_id);
  });

  registry.register(
    'createChange',
    async (request: { project_id: UUID; description: string }) => {
      const change: Change = {
        id: generateUUID(),
        project_id: request.project_id,
        description: request.description,
        status: 'pending',
        impact: defaultImpact(),
        created_at: new Date().toISOString(),
      };
      const changes = getChanges(store);
      changes.push(change);
      setChanges(store, changes);
      return change;
    }
  );

  registry.register('getChangeImpact', async (request: { id: UUID }) => {
    const change = getChanges(store).find((c) => c.id === request.id);
    if (!change) {
      throw new ApiClientError(404, 'NOT_FOUND', '变更不存在', generateUUID());
    }
    return {
      change_id: change.id,
      status: change.status,
      impact: change.impact,
    };
  });

  registry.register(
    'confirmChange',
    async (request: { id: UUID; expected_version: number }) => {
      const changes = getChanges(store);
      const idx = changes.findIndex((c) => c.id === request.id);
      if (idx < 0) {
        throw new ApiClientError(404, 'NOT_FOUND', '变更不存在', generateUUID());
      }
      void request.expected_version;
      changes[idx] = {
        ...changes[idx],
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      };
      setChanges(store, changes);
      return changes[idx];
    }
  );

  registry.register(
    'withdrawChange',
    async (request: { id: UUID; expected_version: number }) => {
      const changes = getChanges(store);
      const idx = changes.findIndex((c) => c.id === request.id);
      if (idx < 0) {
        throw new ApiClientError(404, 'NOT_FOUND', '变更不存在', generateUUID());
      }
      void request.expected_version;
      changes[idx] = { ...changes[idx], status: 'withdrawn' };
      setChanges(store, changes);
      return changes[idx];
    }
  );
}
