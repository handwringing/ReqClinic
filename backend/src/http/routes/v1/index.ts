/**
 * v1 route registrations barrel.
 *
 * Each module exports a `register*Routes(registry, deps)` function that mounts
 * its operationIds onto the shared {@link RouteRegistry}. The barrel keeps the
 * import surface flat so `app.ts` (or a future bootstrap module) can wire every
 * domain with a single import.
 */
export { registerAuthRoutes } from './auth-routes';
export type { AuthRouteDeps } from './auth-routes';

export { registerGuestRoutes } from './guest-routes';
export type { GuestRouteDeps } from './guest-routes';

export { registerAgreementRoutes } from './agreement-routes';
export type { AgreementRouteDeps } from './agreement-routes';

export { registerProjectRoutes } from './project-routes';
export type { ProjectRouteDeps } from './project-routes';
export { registerFormalRoutes } from './formal-routes';
export type { FormalRouteDeps } from './formal-routes';
export { registerQuickRoutes } from './quick-routes';
export type { QuickRouteDeps } from './quick-routes';
export { registerCoreQueryRoutes } from './core-query-routes';
export type { CoreQueryRouteDeps } from './core-query-routes';
export { registerCoreWriteRoutes } from './core-write-routes';
export type { CoreWriteRouteDeps } from './core-write-routes';
export { registerDomainRoutes } from './domain-routes';
export type { DomainRouteDeps } from './domain-routes';
export { registerJobRoutes } from './job-routes';
export type { JobRouteDeps } from './job-routes';

export { registerTrainingRoutes } from './training-routes';
export type { TrainingRouteDeps } from './training-routes';

export { registerEventRoutes } from './event-routes';
export type { EventRouteDeps } from './event-routes';

export { registerReportRoutes } from './report-routes';
export type { ReportRouteDeps } from './report-routes';

export { registerChangeRoutes } from './change-routes';
export type { ChangeRouteDeps } from './change-routes';
