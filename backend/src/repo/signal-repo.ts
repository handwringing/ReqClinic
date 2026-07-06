import { eq, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { operationalSignals, type OperationalSignal } from '../db/schema/core';

/**
 * Repository for §6.2 operational_signals — the continuous-observation
 * definitions (metric, threshold, cadence, trigger) attached to a requirement.
 */
export class SignalRepo {
  constructor(private db: DrizzleDB) {}

  /** List operational signals for a requirement, newest-first. */
  listByRequirement(requirementId: string): OperationalSignal[] {
    return this.db
      .select()
      .from(operationalSignals)
      .where(eq(operationalSignals.requirementId, requirementId))
      .orderBy(desc(operationalSignals.createdAt))
      .all();
  }

  /** List operational signals for a project, newest-first. */
  listByProject(projectId: string): OperationalSignal[] {
    return this.db
      .select()
      .from(operationalSignals)
      .where(eq(operationalSignals.projectId, projectId))
      .orderBy(desc(operationalSignals.createdAt))
      .all();
  }
}
