import { createHash } from 'node:crypto';
import { eq, and, desc, asc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  trainingCases,
  trainingAttempts,
  trainingQuestions,
  trainingSummaries,
  trainingFeedback,
  trainingTurns,
  type TrainingCase,
  type TrainingAttempt,
  type TrainingQuestion,
  type TrainingSummary,
  type TrainingFeedback,
  type TrainingTurn,
} from '../db/schema/training';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

/**
 * Actor performing a training action. `kind` determines which ownership column
 * (`user_id` / `guest_session_id`) is consulted; `id` is the corresponding row id.
 */
export interface TrainingActor {
  kind: 'user' | 'guest';
  id: string;
}

/**
 * Frontend-visible public brief for a training case version (§12A.1, 08 §7.2).
 *
 * Excludes `answer_key`, `disclosure_rules` trigger rules, `hidden_facts` and
 * `rubric` — those are private to the backend Training Runtime.
 */
export interface TrainingCasePublicBrief {
  case_id: string;
  case_version: string;
  title: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  role_label: string;
  practice_goal: string;
  visible_constraints: string[];
  evaluation_dimensions_public: string[];
}

/**
 * Complete private manifest for a training case version — only consumed by the
 * backend TrainingPracticeRuntime (Task 1.2). Must never be returned to the
 * browser or route layer.
 */
export interface TrainingCasePrivateManifest {
  persona: {
    role: string;
    communication_style: string;
    knowledge_level: string;
  };
  hidden_facts: Array<{
    id: string;
    dimension: string;
    content: string;
    importance: 'high' | 'medium' | 'low';
  }>;
  disclosure_rules: Array<{
    id: string;
    trigger_intent: string;
    allowed_answer: string;
    related_fact_ids: string[];
  }>;
  rubric: Array<{
    dimension: string;
    max_score: number;
    evidence_rule: string;
  }>;
}

/** Parse a JSON string with a typed fallback; never throws. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface ListCasesOptions {
  limit?: number;
  cursor?: string;
}

export interface CreateAttemptInput {
  caseId: string;
  caseVersion: string;
  actorKind: 'user' | 'guest';
  userId?: string;
  guestSessionId?: string;
}

export interface PostQuestionInput {
  attemptId: string;
  /** User question text. Stored in `training_turns` for this practice only so
   *  refresh / return can restore the exercise; it never writes to projects. */
  question: string;
  /** Message kind (e.g. 'question' | 'clarification') — not persisted; the
   *  training_questions table has no column for it. */
  messageType?: string;
  boundRefs?: unknown[];
}

export interface PostSummaryInput {
  attemptId: string;
  /** Summary body — only its sha256 hash is stored, never the plaintext
   *  (PRD §12A.5). */
  summary: string;
}

export interface RecordFeedbackInput {
  attemptId: string;
  coverageScoreBp: number;
  missingDimensionCount: number;
  feedbackJson: string;
  dimensionBreakdownJson?: string;
  improvementExamplesJson?: string;
}

export interface FeedbackStatus {
  ready: boolean;
  feedback: TrainingFeedback | null;
}

export interface RecordTrainingTurnInput {
  attemptId: string;
  role: 'user' | 'role' | 'coach';
  content: string;
  boundRefs?: unknown[];
  coachProjection?: unknown;
  aiJobId?: string | null;
}

/**
 * Repository for the expressive-training domain (§12A).
 *
 * Training data is strictly isolated from real project data: training outputs
 * never produce formal Fact/Requirement/Decision/ReviewAction, and the training
 * state machine is independent of other modes. Summary bodies are still stored
 * only as hashes; practice turns are persisted solely for training recovery and
 * feedback context.
 */
export class TrainingRepo {
  constructor(private db: DrizzleDB) {}

  // ── cases ────────────────────────────────────────────────────────────────

  /**
   * Paginated list of training cases, newest-version-first per logical case id.
   *
   * A logical case (`case_id`) may have multiple versions; this returns the
   * latest version row for each case, paginated by an opaque `caseId` cursor.
   */
  listCases(opts: ListCasesOptions = {}): {
    items: TrainingCase[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    // Fetch all rows newest-first; the first row seen per case_id is the
    // latest version. Training fixtures are small, so in-memory grouping is
    // acceptable (P2 experimental mode).
    const all = this.db
      .select()
      .from(trainingCases)
      .orderBy(desc(trainingCases.createdAt), desc(trainingCases.id))
      .all();
    const byCase = new Map<string, TrainingCase>();
    for (const row of all) {
      if (!byCase.has(row.caseId)) byCase.set(row.caseId, row);
    }
    let items = Array.from(byCase.values()).sort((a, b) =>
      a.caseId.localeCompare(b.caseId),
    );

    if (cursor) {
      const c = decodeCursor<{ caseId: string }>(cursor);
      const idx = items.findIndex((r) => r.caseId === c.caseId);
      if (idx >= 0) items = items.slice(idx + 1);
    }

    const page = items.slice(0, limit);
    const nextCursor =
      page.length === limit
        ? encodeCursor({ caseId: page[page.length - 1].caseId })
        : null;
    return { items: page, nextCursor };
  }

  /** Fetch a specific case version, or null. */
  getCaseVersion(caseId: string, version: string): TrainingCase | null {
    const row = this.db
      .select()
      .from(trainingCases)
      .where(
        and(
          eq(trainingCases.caseId, caseId),
          eq(trainingCases.version, version),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Return the frontend-visible public brief for a case version (§12A.1,
   * 08 §7.2). Excludes `answer_key`, `disclosure_rules` trigger rules,
   * `hidden_facts` and `rubric` — those are private to the backend Training
   * Runtime and must never reach the browser.
   *
   * Public fields are projected from `scenario_json` (role_label,
   * practice_goal, visible_constraints, description) and `rubric_json`
   * (evaluation_dimensions list — dimension names only, no scoring rules).
   */
  getCaseVersionPublic(
    caseId: string,
    version: string,
  ): TrainingCasePublicBrief | null {
    const row = this.getCaseVersion(caseId, version);
    if (!row) return null;
    const scenario = parseJson<{
      category?: string;
      description?: string;
      role_label?: string;
      practice_goal?: string;
      visible_constraints?: unknown;
    }>(row.scenarioJson, {});
    const rubric = parseJson<{
      evaluation_dimensions?: unknown;
    }>(row.rubricJson, {});
    const visibleConstraints = Array.isArray(scenario.visible_constraints)
      ? (scenario.visible_constraints as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    const evaluationDimensions = Array.isArray(rubric.evaluation_dimensions)
      ? (rubric.evaluation_dimensions as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    return {
      case_id: row.caseId,
      case_version: row.version,
      title: row.title,
      category: scenario.category ?? 'general',
      difficulty: row.difficulty as 'easy' | 'medium' | 'hard',
      description: scenario.description ?? '',
      role_label: scenario.role_label ?? '',
      practice_goal: scenario.practice_goal ?? '',
      visible_constraints: visibleConstraints,
      evaluation_dimensions_public: evaluationDimensions,
    };
  }

  /**
   * Return the complete private manifest for a case version — only for the
   * backend TrainingPracticeRuntime (Task 1.2). Must never be called from the
   * route layer or returned to the browser (08 §7.2).
   *
   * Currently assembles the manifest from the existing `scenario_json`,
   * `disclosure_rules_json` and `rubric_json` columns. The stored shapes are
   * looser than the target manifest, so fields without a direct mapping default
   * to empty strings / arrays. TODO: once a dedicated `manifest_json` column
   * is added by a later DB-migration task, read the structured manifest
   * directly from there.
   */
  getCasePrivateManifest(
    caseId: string,
    version: string,
  ): TrainingCasePrivateManifest | null {
    const row = this.getCaseVersion(caseId, version);
    if (!row) return null;
    const scenario = parseJson<{
      persona?: {
        role?: string;
        communication_style?: string;
        knowledge_level?: string;
      };
      role_label?: string;
    }>(row.scenarioJson, {});
    const rawRules = parseJson<unknown[]>(row.disclosureRulesJson, []);
    const rulesArr = Array.isArray(rawRules) ? rawRules : [];
    const rubric = parseJson<{
      evaluation_dimensions?: unknown;
      rubric?: unknown;
    }>(row.rubricJson, {});
    const dims = Array.isArray(rubric.evaluation_dimensions)
      ? (rubric.evaluation_dimensions as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    const rubricArr = Array.isArray(rubric.rubric)
      ? (rubric.rubric as unknown[]).filter(
          (v): v is Record<string, unknown> =>
            v !== null && typeof v === 'object',
        )
      : [];
    const disclosureRules = rulesArr
      .filter(
        (r): r is Record<string, unknown> =>
          r !== null && typeof r === 'object',
      )
      .map((r, idx) => {
        const id = typeof r.id === 'string' ? r.id : `rule_${idx}`;
        const triggerIntent =
          typeof r.trigger_intent === 'string' ? r.trigger_intent : '';
        const allowedAnswer =
          typeof r.allowed_answer === 'string' ? r.allowed_answer : '';
        const relatedFactIds = Array.isArray(r.related_fact_ids)
          ? (r.related_fact_ids as unknown[]).filter(
              (v): v is string => typeof v === 'string',
            )
          : [];
        return { id, trigger_intent: triggerIntent, allowed_answer: allowedAnswer, related_fact_ids: relatedFactIds };
      });
    const rubricEntries = rubricArr.map((r, idx) => {
      const dimension =
        typeof r.dimension === 'string'
          ? r.dimension
          : (dims[idx] ?? `dimension_${idx}`);
      const maxScore =
        typeof r.max_score === 'number' ? r.max_score : 0;
      const evidenceRule =
        typeof r.evidence_rule === 'string' ? r.evidence_rule : '';
      return { dimension, max_score: maxScore, evidence_rule: evidenceRule };
    });
    return {
      persona: {
        role: scenario.persona?.role ?? scenario.role_label ?? '',
        communication_style: scenario.persona?.communication_style ?? '',
        knowledge_level: scenario.persona?.knowledge_level ?? '',
      },
      // TODO: hidden_facts require a dedicated manifest_json column; return
      // empty until the DB-migration task lands.
      hidden_facts: [],
      disclosure_rules: disclosureRules,
      rubric: rubricEntries,
    };
  }

  // ── attempts ────────────────────────────────────────────────────────────

  /** Find an attempt by id, or null. */
  findById(id: string): TrainingAttempt | null {
    const row = this.db
      .select()
      .from(trainingAttempts)
      .where(eq(trainingAttempts.id, id))
      .get();
    return row ?? null;
  }

  /**
   * Find an attempt by id and verify the actor owns it.
   *
   * Throws `NOT_FOUND` when the attempt does not exist or the actor does not
   * own it (to avoid leaking existence to non-owners).
   */
  findByIdForActor(id: string, actor: TrainingActor): TrainingAttempt {
    const attempt = this.findById(id);
    if (!attempt) {
      throw ApiError.notFound('Training attempt not found', 'training_attempt');
    }
    const ownerId =
      actor.kind === 'user' ? attempt.userId : attempt.guestSessionId;
    if (ownerId !== actor.id) {
      throw ApiError.notFound('Training attempt not found', 'training_attempt');
    }
    return attempt;
  }

  /**
   * Create a new training attempt.
   *
   * Verifies the case version exists (throws `TRAINING_CASE_NOT_FOUND` 404 if
   * not), computes the next attempt number for this actor+case, and starts the
   * attempt in `interviewing` status. Training data never writes to real
   * project tables.
   */
  createAttempt(input: CreateAttemptInput): TrainingAttempt {
    if (input.actorKind === 'user' && !input.userId) {
      throw ApiError.validationError({
        userId: 'required for actorKind=user',
      });
    }
    if (input.actorKind === 'guest' && !input.guestSessionId) {
      throw ApiError.validationError({
        guestSessionId: 'required for actorKind=guest',
      });
    }

    const caseRow = this.getCaseVersion(input.caseId, input.caseVersion);
    if (!caseRow) {
      throw new ApiError(
        404,
        'TRAINING_CASE_NOT_FOUND',
        'Training case or version not found',
        { details: { resource: 'training_case' } },
      );
    }

    const ownerCol =
      input.actorKind === 'user'
        ? trainingAttempts.userId
        : trainingAttempts.guestSessionId;
    const ownerId =
      input.actorKind === 'user' ? input.userId! : input.guestSessionId!;
    const prior = this.db
      .select({ id: trainingAttempts.id })
      .from(trainingAttempts)
      .where(
        and(
          eq(trainingAttempts.caseId, input.caseId),
          eq(ownerCol, ownerId),
        ),
      )
      .all();

    const ts = now();
    const row = this.db
      .insert(trainingAttempts)
      .values({
        id: generateId('ta'),
        caseId: input.caseId,
        caseVersion: input.caseVersion,
        userId: input.userId ?? null,
        guestSessionId: input.guestSessionId ?? null,
        status: 'interviewing',
        startedAt: ts,
        completedAt: null,
        attemptNumber: prior.length + 1,
        createdAt: ts,
        version: 1,
      })
      .returning()
      .get();

    return row;
  }

  // ── questions ───────────────────────────────────────────────────────────

  /**
   * Record a training question.
   *
   * `training_questions` persists only `question_index` and the disclosure hit.
   * The question text is stored as a training-only turn so the practice can be
   * restored after refresh; it is never promoted into quick/formal/project data.
   */
  postQuestion(input: PostQuestionInput): TrainingQuestion {
    if (!this.findById(input.attemptId)) {
      throw ApiError.notFound('Training attempt not found', 'training_attempt');
    }
    const existing = this.db
      .select({ idx: trainingQuestions.questionIndex })
      .from(trainingQuestions)
      .where(eq(trainingQuestions.attemptId, input.attemptId))
      .all();
    const questionIndex = existing.length;
    const row = this.db
      .insert(trainingQuestions)
      .values({
        id: generateId('tq'),
        attemptId: input.attemptId,
        questionIndex,
        askedAt: now(),
        disclosureRuleHit: null,
      })
      .returning()
      .get();
    this.recordTurn({
      attemptId: input.attemptId,
      role: 'user',
      content: input.question,
      boundRefs: input.boundRefs,
    });
    return row;
  }

  countQuestions(attemptId: string): number {
    return this.db
      .select({ id: trainingQuestions.id })
      .from(trainingQuestions)
      .where(eq(trainingQuestions.attemptId, attemptId))
      .all().length;
  }

  recordTurn(input: RecordTrainingTurnInput): TrainingTurn {
    if (!this.findById(input.attemptId)) {
      throw ApiError.notFound('Training attempt not found', 'training_attempt');
    }
    const cleanContent = input.content.trim();
    if (!cleanContent) {
      throw ApiError.validationError({ content: 'must be a non-empty string' });
    }

    if (input.aiJobId) {
      const existing = this.db
        .select()
        .from(trainingTurns)
        .where(
          and(
            eq(trainingTurns.aiJobId, input.aiJobId),
            eq(trainingTurns.role, input.role),
          ),
        )
        .get();
      if (existing) return existing;
    }

    return this.db
      .insert(trainingTurns)
      .values({
        id: generateId('tt'),
        attemptId: input.attemptId,
        role: input.role,
        content: cleanContent,
        boundRefsJson: JSON.stringify(input.boundRefs ?? []),
        coachProjectionJson: JSON.stringify(input.coachProjection ?? {}),
        aiJobId: input.aiJobId ?? null,
        createdAt: now(),
      })
      .returning()
      .get();
  }

  listTurns(attemptId: string): TrainingTurn[] {
    return this.db
      .select()
      .from(trainingTurns)
      .where(eq(trainingTurns.attemptId, attemptId))
      .orderBy(asc(trainingTurns.createdAt), asc(trainingTurns.id))
      .all();
  }

  latestCoachProjection(attemptId: string): Record<string, unknown> | null {
    const rows = this.db
      .select()
      .from(trainingTurns)
      .where(eq(trainingTurns.attemptId, attemptId))
      .orderBy(desc(trainingTurns.createdAt), desc(trainingTurns.id))
      .all();
    for (const row of rows) {
      const projection = parseJson<Record<string, unknown>>(row.coachProjectionJson, {});
      if (projection && Object.keys(projection).length > 0) return projection;
    }
    return null;
  }

  // ── summaries ───────────────────────────────────────────────────────────

  /**
   * Submit a training summary.
   *
   * Only the sha256 hash of the summary is stored (never the plaintext); the
   * attempt transitions to `summarizing`. A new `summary_version` is allocated
   * per submission for the attempt.
   */
  postSummary(input: PostSummaryInput): TrainingSummary {
    if (!this.findById(input.attemptId)) {
      throw ApiError.notFound('Training attempt not found', 'training_attempt');
    }
    const summaryHash = createHash('sha256')
      .update(input.summary, 'utf8')
      .digest('hex');
    const existing = this.db
      .select({ v: trainingSummaries.version })
      .from(trainingSummaries)
      .where(eq(trainingSummaries.attemptId, input.attemptId))
      .all();
    const nextVersion = existing.length + 1;
    const ts = now();
    const row = this.db
      .insert(trainingSummaries)
      .values({
        id: generateId('ts'),
        attemptId: input.attemptId,
        version: nextVersion,
        summaryHash,
        submittedAt: ts,
      })
      .returning()
      .get();

    this.db
      .update(trainingAttempts)
      .set({ status: 'summarizing' })
      .where(eq(trainingAttempts.id, input.attemptId))
      .run();

    return row;
  }

  // ── feedback ────────────────────────────────────────────────────────────

  /**
   * Return the feedback readiness for an attempt.
   *
   * `ready` is true once a `training_feedback` row exists for the attempt.
   * Drizzle's better-sqlite3 `.get()` returns `undefined` (not `null`) when no
   * row matches, so a loose `!= null` check is required to catch both.
   */
  getFeedback(attemptId: string): FeedbackStatus {
    const row = this.db
      .select()
      .from(trainingFeedback)
      .where(eq(trainingFeedback.attemptId, attemptId))
      .get();
    return { ready: row != null, feedback: row ?? null };
  }

  /**
   * Mark an attempt as completed. Only the owning actor may complete it; the
   * `completed` status is terminal for the attempt state machine and is not an
   * authoritative capability certification (§12A.8). Returns the updated row.
   */
  complete(id: string, actor: TrainingActor): TrainingAttempt {
    const attempt = this.findByIdForActor(id, actor);
    const ts = now();
    const updated = this.db
      .update(trainingAttempts)
      .set({ status: 'completed', completedAt: ts })
      .where(eq(trainingAttempts.id, attempt.id))
      .returning()
      .get();
    return updated;
  }

  /**
   * Record deterministic feedback for an attempt and transition the attempt to
   * `feedback_ready`. Used by the feedback-generation flow (and tests) to mark
   * readiness; the score is for this attempt only and is not a certification.
   */
  recordFeedback(input: RecordFeedbackInput): TrainingFeedback {
    if (!this.findById(input.attemptId)) {
      throw ApiError.notFound('Training attempt not found', 'training_attempt');
    }
    const row = this.db
      .insert(trainingFeedback)
      .values({
        id: generateId('tf'),
        attemptId: input.attemptId,
        coverageScoreBp: input.coverageScoreBp,
        missingDimensionCount: input.missingDimensionCount,
        feedbackJson: input.feedbackJson,
        dimensionBreakdownJson: input.dimensionBreakdownJson ?? '[]',
        improvementExamplesJson: input.improvementExamplesJson ?? '[]',
        generatedAt: now(),
      })
      .returning()
      .get();

    this.db
      .update(trainingAttempts)
      .set({ status: 'feedback_ready' })
      .where(eq(trainingAttempts.id, input.attemptId))
      .run();

    return row;
  }
}
