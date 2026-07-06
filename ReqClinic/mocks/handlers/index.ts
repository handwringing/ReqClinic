import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import { registerAuthHandlers } from './auth';
import { registerGuestSessionHandlers } from './guest-session';
import { registerAgreementHandlers } from './agreement';
import { registerQuickSessionHandlers } from './quick-session';
import { registerProjectHandlers } from './project';
import { registerDomainHandlers } from './domain';
import { registerSourceHandlers } from './source';
import { registerAnalysisHandlers } from './analysis';
import { registerRequirementHandlers } from './requirement';
import { registerReviewHandlers } from './review';
import { registerReportHandlers } from './report';
import { registerChangeHandlers } from './change';
import { registerTrainingHandlers } from './training';
import { registerEventHandlers } from './events';
import { registerJobHandlers } from './job';

export function registerAllHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registerAuthHandlers(registry, store);
  registerGuestSessionHandlers(registry, store);
  registerAgreementHandlers(registry, store);
  registerQuickSessionHandlers(registry, store);
  registerProjectHandlers(registry, store);
  registerDomainHandlers(registry, store);
  registerSourceHandlers(registry, store);
  registerAnalysisHandlers(registry, store);
  registerRequirementHandlers(registry, store);
  registerReviewHandlers(registry, store);
  registerReportHandlers(registry, store);
  registerChangeHandlers(registry, store);
  registerTrainingHandlers(registry, store);
  registerEventHandlers(registry, store);
  registerJobHandlers(registry, store);
}
