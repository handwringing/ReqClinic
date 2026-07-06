/**
 * Barrel export aggregating every Drizzle schema module (DB v1.2).
 *
 * Domain split (13 modules + system):
 *   identity  — users, guest sessions, agreements (§3)
 *   project   — projects, members, intakes (§3)
 *   domain    — domain profiles, domain packs (§4)
 *   quick     — quick sessions, briefs, upgrades (§4A)
 *   source    — blobs, sources, evidence spans (§5)
 *   core      — stakeholders, requirements, drivers, outcomes, conflicts, ... (§6/§7)
 *   review    — review actions, requirement versions, baselines, tasks (§7)
 *   change    — change previews, changes, impacts (§8)
 *   job       — AI jobs, runs, idempotency records (§9)
 *   report    — report templates, snapshots, gate results (§10)
 *   event     — product events, entity change logs (§11)
 *   training  — training cases, attempts, questions, summaries, feedback (§12A)
 *   lifecycle — delete tasks, deletion ledger (§14)
 *   system    — schema migrations (§15)
 */
export * from './system';
export * from './identity';
export * from './project';
export * from './formal';
export * from './domain';
export * from './quick';
export * from './source';
export * from './core';
export * from './review';
export * from './change';
export * from './job';
export * from './report';
export * from './event';
export * from './training';
export * from './lifecycle';
