import { eq, and, desc, max } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  domainProfiles,
  type DomainProfile,
} from '../db/schema/domain';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

/**
 * Repository for the `domain_profiles` table (§4.1 / §6).
 *
 * A domain profile is the AI-generated, human-approved project profile. New
 * candidates auto-increment `profile_version` per project; the previous latest
 * profile is superseded via `supersedes_profile_id`. Status transitions follow
 * `candidate → under_review → approved | rejected`, with `superseded` reserved
 * for previously-approved profiles replaced by a newer approved one.
 */

export interface CreateDomainProfileInput {
  projectId: string;
  /** Pack ids suggested by the classifier; persisted as `suggested_pack_ids_json`. */
  candidatePackIds: string[];
  status: string;
  // Optional structural fields; defaults are empty so a bare candidate insert
  // still satisfies the NOT NULL JSON columns.
  workType?: string;
  domainLabels?: string[];
  riskFlags?: string[];
  terminologyMap?: Record<string, string>;
  requiredHumanRoles?: string[];
  routingRisk?: string;
  routingBasis?: Record<string, unknown>;
  rationaleEvidenceLinks?: string[];
  unknowns?: Array<Record<string, unknown>>;
  classifierModel?: string;
  promptVersion?: string;
  supersedesProfileId?: string;
}

export class DomainProfileRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Insert a new domain-profile version for a project.
   *
   * `profile_version` auto-increments per project; when version > 1 the
   * previous latest profile is referenced via `supersedes_profile_id`.
   */
  create(input: CreateDomainProfileInput): DomainProfile {
    const last = this.db
      .select({ m: max(domainProfiles.profileVersion) })
      .from(domainProfiles)
      .where(eq(domainProfiles.projectId, input.projectId))
      .get();
    const nextVersion = (last?.m ?? 0) + 1;

    let supersedesId = input.supersedesProfileId ?? null;
    if (supersedesId === null && nextVersion > 1) {
      const prev = this.db
        .select()
        .from(domainProfiles)
        .where(eq(domainProfiles.projectId, input.projectId))
        .orderBy(desc(domainProfiles.profileVersion))
        .limit(1)
        .get();
      supersedesId = prev?.id ?? null;
    }

    const id = generateId('dpm');
    const ts = now();
    const row = this.db
      .insert(domainProfiles)
      .values({
        id,
        projectId: input.projectId,
        profileVersion: nextVersion,
        workType: input.workType ?? 'unknown',
        domainLabelsJson: JSON.stringify(input.domainLabels ?? []),
        riskFlagsJson: JSON.stringify(input.riskFlags ?? []),
        terminologyMapJson: JSON.stringify(input.terminologyMap ?? {}),
        suggestedPackIdsJson: JSON.stringify(input.candidatePackIds),
        requiredHumanRolesJson: JSON.stringify(input.requiredHumanRoles ?? []),
        routingRisk: input.routingRisk ?? 'unknown',
        routingBasisJson: JSON.stringify(input.routingBasis ?? {}),
        rationaleEvidenceLinksJson: JSON.stringify(input.rationaleEvidenceLinks ?? []),
        unknownsJson: JSON.stringify(input.unknowns ?? []),
        status: input.status,
        classifierModel: input.classifierModel ?? null,
        promptVersion: input.promptVersion ?? null,
        approvedBy: null,
        approvedAt: null,
        supersedesProfileId: supersedesId,
        createdAt: ts,
      })
      .returning()
      .get();

    return row;
  }

  /** Find a domain profile by id, or null. */
  findById(id: string): DomainProfile | null {
    const row = this.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.id, id))
      .get();
    return row ?? null;
  }

  /**
   * Return the "current" profile for a project: the latest approved one if any,
   * otherwise the latest non-superseded/rejected candidate. Null when no
   * profile exists.
   */
  findCurrentByProject(projectId: string): DomainProfile | null {
    const approved = this.findApprovedVersion(projectId);
    if (approved) return approved;
    const row = this.db
      .select()
      .from(domainProfiles)
      .where(
        and(
          eq(domainProfiles.projectId, projectId),
          eq(domainProfiles.status, 'candidate'),
        ),
      )
      .orderBy(desc(domainProfiles.profileVersion))
      .limit(1)
      .get();
    return row ?? null;
  }

  /** Return the latest `approved` profile for a project, or null. */
  findApprovedVersion(projectId: string): DomainProfile | null {
    const row = this.db
      .select()
      .from(domainProfiles)
      .where(
        and(
          eq(domainProfiles.projectId, projectId),
          eq(domainProfiles.status, 'approved'),
        ),
      )
      .orderBy(desc(domainProfiles.profileVersion))
      .limit(1)
      .get();
    return row ?? null;
  }

  /**
   * Transition a profile's status with optimistic-concurrency check on
   * `profile_version`. On `approved`, stamps `approved_by` / `approved_at` and
   * supersedes any previously-approved profile for the same project.
   */
  updateStatus(
    id: string,
    status: string,
    expectedVersion?: number,
    approvedBy?: string,
  ): DomainProfile {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Domain profile not found', 'domain_profile');
    }
    if (expectedVersion !== undefined && current.profileVersion !== expectedVersion) {
      throw ApiError.versionConflict();
    }

    const patch: Partial<typeof domainProfiles.$inferInsert> = {
      status,
    };
    if (status === 'approved') {
      patch.approvedBy = approvedBy ?? current.approvedBy ?? null;
      patch.approvedAt = now();
    }

    const updated = this.db
      .update(domainProfiles)
      .set(patch)
      .where(eq(domainProfiles.id, id))
      .returning()
      .get();

    // Supersede the previously-approved profile (if different) so only one
    // approved row remains current per project.
    if (status === 'approved') {
      const previousApproved = this.db
        .select()
        .from(domainProfiles)
        .where(
          and(
            eq(domainProfiles.projectId, current.projectId),
            eq(domainProfiles.status, 'approved'),
          ),
        )
        .all()
        .filter((r) => r.id !== id);
      for (const r of previousApproved) {
        this.db
          .update(domainProfiles)
          .set({ status: 'superseded' })
          .where(eq(domainProfiles.id, r.id))
          .run();
      }
    }

    return updated;
  }
}
