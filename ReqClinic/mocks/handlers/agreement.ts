import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { Agreement, AgreementConsent, UUID } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';

// 协议同意 Mock：固定协议版本、同意/重新同意/撤回/列表。

const ACTIVE_AGREEMENT: Agreement = {
  id: '00000000-0000-4000-8000-000000000001',
  version: '2026.07.01',
  title: '需求问诊室使用协议',
  content_ref: 'agreements://reqclinic/2026.07.01.md',
  effective_at: '2026-07-01T00:00:00.000Z',
  is_active: true,
};

export function registerAgreementHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register('getActiveAgreement', async () => {
    return ACTIVE_AGREEMENT;
  });

  registry.register(
    'acceptAgreement',
    async (request: { agreement_id: UUID; scope: 'quick' | 'formal' | 'training' }, options) => {
      const consent: AgreementConsent = {
        id: generateUUID(),
        agreement_id: request.agreement_id,
        agreement_version: ACTIVE_AGREEMENT.version,
        scope: request.scope,
        consented_at: new Date().toISOString(),
        idempotency_key: (options?.idempotencyKey as UUID) ?? generateUUID(),
      };
      const consents = store.getConsents();
      consents.push(consent);
      store.setConsents(consents);
      return consent;
    }
  );

  registry.register(
    'reacceptAgreement',
    async (request: { agreement_id: UUID; scope: 'quick' | 'formal' | 'training' }, options) => {
      const consent: AgreementConsent = {
        id: generateUUID(),
        agreement_id: request.agreement_id,
        agreement_version: ACTIVE_AGREEMENT.version,
        scope: request.scope,
        consented_at: new Date().toISOString(),
        idempotency_key: (options?.idempotencyKey as UUID) ?? generateUUID(),
      };
      const consents = store.getConsents();
      consents.push(consent);
      store.setConsents(consents);
      return consent;
    }
  );

  registry.register('withdrawAgreementConsent', async (request: { consent_id: UUID }) => {
    const consents = store.getConsents();
    const idx = consents.findIndex((c) => c.id === request.consent_id);
    if (idx < 0) {
      throw new ApiClientError(404, 'NOT_FOUND', '未找到对应的同意记录', generateUUID());
    }
    consents[idx] = { ...consents[idx], withdrawn_at: new Date().toISOString() };
    store.setConsents(consents);
    return consents[idx];
  });

  registry.register(
    'listAgreementConsents',
    async (request: { scope?: 'quick' | 'formal' | 'training'; limit?: number; offset?: number }) => {
      const all = store.getConsents();
      const filtered = request.scope ? all.filter((c) => c.scope === request.scope) : all;
      const limit = request.limit ?? 20;
      const offset = request.offset ?? 0;
      const items = filtered.slice(offset, offset + limit);
      return { items, total: filtered.length, limit, offset };
    }
  );
}
