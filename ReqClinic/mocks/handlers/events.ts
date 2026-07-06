import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { ProductEvent, ProductEventBatchResponse, QuickCompletionRateResponse } from '@/lib/api/types';

// 产品埋点 Mock：接收事件、返回示例完成率。

export function registerEventHandlers(registry: MockRouteRegistry, _store: MockSessionStore): void {
  registry.register('postProductEvents', async (request: { events: ProductEvent[] }): Promise<ProductEventBatchResponse> => {
    return {
      accepted_count: request.events.length,
      rejected_count: 0,
      duplicates_count: 0,
    };
  });

  registry.register(
    'getQuickCompletionRate',
    async (request: { observation_window?: string; source_kind?: string }): Promise<QuickCompletionRateResponse> => {
      void request;
      return {
        metric_name: 'quick-completion-rate',
        numerator: 122,
        denominator: 156,
        observation_window: request.observation_window ?? '30d',
        sample_size: 156,
        calculated_at: new Date().toISOString(),
      };
    }
  );
}
