import { eq, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { verificationArtifacts, requirements, type VerificationArtifact } from '../db/schema/core';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export interface CreateVerificationInput {
  requirementId: string;
  acceptanceCriterionId?: string;
  artifactType: string;
  description?: string;
  sourceId?: string;
  artifactPath?: string;
  result?: string;
  executedAt?: string;
  verifiedBy?: string;
  status?: string;
}

/**
 * Repository for §6.2 verification_artifacts.
 *
 * A verification artifact records a test/inspection result for a requirement
 * (optionally linked to an acceptance criterion). At least one of source_id /
 * artifact_path / result must be set (enforced by a CHECK constraint).
 */
export class VerificationRepo {
  constructor(private db: DrizzleDB) {}

  /** List verification artifacts for a requirement, newest-first. */
  listByRequirement(requirementId: string): VerificationArtifact[] {
    return this.db
      .select()
      .from(verificationArtifacts)
      .where(eq(verificationArtifacts.requirementId, requirementId))
      .orderBy(desc(verificationArtifacts.createdAt))
      .all();
  }

  /** Register a new verification artifact. */
  create(input: CreateVerificationInput): VerificationArtifact {
    const req = this.db
      .select({ id: requirements.id, projectId: requirements.projectId })
      .from(requirements)
      .where(eq(requirements.id, input.requirementId))
      .get();
    if (!req) throw ApiError.notFound('Requirement not found', 'requirement');

    // CHECK: source_id IS NOT NULL OR artifact_path IS NOT NULL OR result IS NOT NULL
    if (
      !input.sourceId &&
      !input.artifactPath &&
      input.result === undefined
    ) {
      throw ApiError.validationError({
        verification:
          'one of source_id, artifact_path, or result is required',
      });
    }

    return this.db
      .insert(verificationArtifacts)
      .values({
        id: generateId('va'),
        projectId: req.projectId,
        requirementId: input.requirementId,
        acceptanceCriterionId: input.acceptanceCriterionId ?? null,
        artifactType: input.artifactType,
        description: input.description ?? null,
        sourceId: input.sourceId ?? null,
        artifactPath: input.artifactPath ?? null,
        result: input.result ?? null,
        executedAt: input.executedAt ?? null,
        verifiedBy: input.verifiedBy ?? null,
        status: input.status ?? 'available',
        createdAt: now(),
      })
      .returning()
      .get();
  }
}
