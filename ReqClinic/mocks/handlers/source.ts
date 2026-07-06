import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID, Source, EvidenceSpan, PaginatedResponse } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { asterFixture } from './_fixtures';

// 来源与证据 Mock：上传、列表、证据片段。

function getSources(store: MockSessionStore): Source[] {
  return store.get<Source[]>('sources') ?? [];
}

function setSources(store: MockSessionStore, sources: Source[]): void {
  store.set('sources', sources);
}

export function registerSourceHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register(
    'listSources',
    async (request: { project_id: UUID; limit?: number; offset?: number }) => {
      let sources = getSources(store).filter((s) => s.project_id === request.project_id);
      // 若 store 无数据，回退到 Aster fixture。
      if (sources.length === 0) {
        const fx = asterFixture();
        const fxSources = fx?.sources ?? [];
        sources = fxSources.map((s: any) => ({ ...s, project_id: request.project_id }));
      }
      const limit = request.limit ?? 20;
      const offset = request.offset ?? 0;
      const items = sources.slice(offset, offset + limit);
      return { items, total: sources.length, limit, offset } as PaginatedResponse<Source>;
    }
  );

  registry.register(
    'uploadSource',
    async (request: {
      project_id: UUID;
      filename: string;
      mime_type: string;
      byte_size: number;
      sensitivity: 'public' | 'internal' | 'confidential';
    }) => {
      const source: Source = {
        id: generateUUID(),
        project_id: request.project_id,
        filename: request.filename,
        mime_type: request.mime_type,
        byte_size: request.byte_size,
        sensitivity: request.sensitivity,
        extraction_status: 'completed',
        uploaded_at: new Date().toISOString(),
      };
      const sources = getSources(store);
      sources.push(source);
      setSources(store, sources);
      return source;
    }
  );

  registry.register('getEvidence', async (request: { source_id: UUID }) => {
    const fx = asterFixture();
    const fxSpans: any[] = fx?.evidence_spans ?? [];
    const spans: EvidenceSpan[] = fxSpans
      .filter((s: any) => s.source_id === request.source_id)
      .map((s: any) => ({
        id: s.id ?? generateUUID(),
        source_id: s.source_id ?? request.source_id,
        text: s.text ?? '',
        location: s.location ?? { start: 0, end: 0 },
        speaker: s.speaker,
        timestamp: s.timestamp,
      }));
    return spans;
  });
}
