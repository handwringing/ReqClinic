/**
 * Vitest global setup.
 *
 * Runs once per test file before any source module is imported. Source modules
 * parse `process.env` via `src/config/env.ts` at import time, so we pin a
 * deterministic environment here to keep tests hermetic regardless of the
 * shell that launches the suite.
 */
process.env.NODE_ENV = 'test';
if (!process.env.SERVER_PEPPER) {
  process.env.SERVER_PEPPER = 'test-pepper';
}
