/**
 * Barrel export for all HTTP middleware.
 *
 *   request-id   — per-request correlation id (existing)
 *   auth         — actor resolution + capability guards
 *   agreement-gate — consent enforcement for AI-gated operations
 *   idempotency  — Idempotency-Key replay & conflict detection
 *   version-check — optimistic-concurrency guard
 *   rate-limit   — sliding-window rate limiter
 */
export * from './request-id';
export * from './auth';
export * from './agreement-gate';
export * from './idempotency';
export * from './version-check';
export * from './rate-limit';
