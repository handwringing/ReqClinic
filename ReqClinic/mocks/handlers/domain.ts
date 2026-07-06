import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID, DomainProfile, DomainPack, DomainPackVersionDetail, ActivateDomainPackRequest, ActivateDomainPackResponse, PaginatedResponse } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { asterFixture } from './_fixtures';

// 领域画像 Mock：pack 列表、版本详情、激活/停用预演、评审。

const PACKS: DomainPack[] = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    code: 'general',
    name: '通用软件交付',
    version: '2026.07.01',
    is_static: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000011',
    code: 'software-delivery',
    name: '软件交付领域包',
    version: '2026.07.01',
    is_static: true,
  },
];

function getProfiles(store: MockSessionStore): Record<string, DomainProfile> {
  return store.get<Record<string, DomainProfile>>('domain_profiles') ?? {};
}

function setProfiles(store: MockSessionStore, profiles: Record<string, DomainProfile>): void {
  store.set('domain_profiles', profiles);
}

export function registerDomainHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register('getDomainProfile', async (request: { project_id: UUID }) => {
    const profiles = getProfiles(store);
    const existing = profiles[request.project_id];
    if (existing) return existing;
    // 回退到 Aster fixture。
    const fx = asterFixture();
    const fxDp = fx?.domain_profile;
    return {
      id: fxDp?.id ?? generateUUID(),
      project_id: request.project_id,
      status: fxDp?.status ?? 'accepted',
      suggested_packs: fxDp?.suggested_packs ?? ['general', 'software-delivery'],
      review_result: fxDp?.review_result,
    } as DomainProfile;
  });

  registry.register('reviewDomainProfile', async () => {
    return { job_id: generateUUID(), status: 'accepted' as const };
  });

  registry.register(
    'listDomainPacks',
    async (request: { limit?: number; offset?: number }) => {
      const limit = request.limit ?? 20;
      const offset = request.offset ?? 0;
      const items = PACKS.slice(offset, offset + limit);
      return { items, total: PACKS.length, limit, offset } as PaginatedResponse<DomainPack>;
    }
  );

  registry.register(
    'getDomainPackVersion',
    async (request: { id: UUID; version: string }) => {
      const pack = PACKS.find((p) => p.id === request.id || p.code === request.id);
      if (!pack) {
        throw new ApiClientError(404, 'NOT_FOUND', '领域包版本不存在', generateUUID());
      }
      const detail: DomainPackVersionDetail = {
        id: pack.code,
        version: pack.version,
        name: pack.name,
        status: 'released',
        compatible_core_schema: '1.0.0',
        manifest: { entity_types: ['requirement', 'outcome', 'driver'] },
        manifest_hash: 'sha256:mock',
        released_at: '2026-07-01T00:00:00Z',
        deprecated_at: null,
      };
      return detail;
    }
  );

  registry.register(
    'activateDomainPack',
    async (request: { project_id: UUID; pack_id: UUID } & ActivateDomainPackRequest) => {
      const response: ActivateDomainPackResponse = {
        id: generateUUID(),
        project_id: request.project_id,
        domain_pack_id: request.pack_id,
        domain_pack_version: request.domain_pack_version,
        domain_profile_id: request.domain_profile_id,
        activation_reason: request.activation_reason,
        status: 'active',
        activated_by: '00000000-0000-4000-8000-000000000099',
        activated_at: new Date().toISOString(),
      };
      return response;
    }
  );

  registry.register(
    'previewDeactivation',
    async (request: { project_id: UUID; pack_id: UUID; domain_pack_version: string }) => {
      return {
        preview_id: generateUUID(),
        project_id: request.project_id,
        pack_id: request.pack_id,
        domain_pack_version: request.domain_pack_version,
        impact: [{ entity_type: 'requirement', impact_type: 'modified', severity: 'minor', recommended_action: '复核相关需求归属' }],
      };
    }
  );

  registry.register(
    'deactivateDomainPack',
    async (request: { project_id: UUID; pack_id: UUID; preview_id: string; domain_pack_version: string; expected_version: number }) => {
      void request;
      return { status: 'deactivated' };
    }
  );
}
