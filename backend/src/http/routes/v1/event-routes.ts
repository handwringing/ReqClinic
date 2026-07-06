import { z } from 'zod';
import type { RouteRegistry, RouteContext, Actor } from '../../route-registry';
import { ApiError } from '../../errors';
import { now, addDays } from '../../../shared/time';
import type { EventRepo, ProductEventInput } from '../../../repo/event-repo';

/**
 * Product-analytics event routes (Task 30, §12B).
 *
 * Registers 2 operationIds: the batch event-ingestion endpoint and the minimal
 * SQL report for the quick-completion-rate metric.
 *
 * `product_events.attributes` is a versioned JSON blob validated per event
 * name + schema version, kept strictly separate from auth credentials. The raw
 * `userId` / `guest_session_id` never reach `product_events`; only a
 * pseudonymized `actor_key` and a non-secret `analytics_session_id` are stored.
 */

export interface EventRouteDeps {
  eventRepo: EventRepo;
}

// ── constants ───────────────────────────────────────────────────────────────

const ENVIRONMENTS = new Set([
  'demo',
  'development',
  'test',
  'pilot',
  'production',
]);
const MODES = new Set(['quick', 'formal', 'training', 'entry']);
const SOURCE_KINDS = new Set([
  'custom',
  'sample',
  'training_fixture',
  'internal_test',
]);

// ── zod request schemas ─────────────────────────────────────────────────────

const productEventSchema = z.object({
  event_id: z.string().min(1),
  event_name: z.string().min(1),
  event_schema_version: z.string().min(1),
  occurred_at: z.string().min(1),
  environment: z.string().refine((v) => ENVIRONMENTS.has(v), {
    message: 'invalid environment',
  }),
  app_version: z.string().min(1),
  mode: z.string().refine((v) => MODES.has(v), { message: 'invalid mode' }),
  source_kind: z.string().refine((v) => SOURCE_KINDS.has(v), {
    message: 'invalid source_kind',
  }),
  analytics_session_id: z.string().regex(/^AS_[A-Za-z0-9_-]+$/),
  actor_key: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  experiment_id: z.string().nullable().optional(),
  attributes: z.record(z.unknown()).default({}),
});

const batchSchema = z.object({
  events: z.array(productEventSchema).min(1),
});

// ── helpers ─────────────────────────────────────────────────────────────────

function toRepoActor(actor: Actor): { kind: 'user' | 'guest'; id: string } {
  if (actor.kind === 'user' && actor.userId) {
    return { kind: 'user', id: actor.userId };
  }
  if (actor.kind === 'guest' && actor.guestSessionId) {
    return { kind: 'guest', id: actor.guestSessionId };
  }
  throw ApiError.unauthenticated();
}

function validateBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.validationError(result.error.flatten().fieldErrors);
  }
  return result.data;
}

/** Parse an observation window like "7d" / "30d" into a day count. */
function parseObservationWindow(window: string): number {
  const m = /^(\d+)d$/.exec(window);
  if (!m) return 7;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

// ── registration ────────────────────────────────────────────────────────────

export function registerEventRoutes(
  registry: RouteRegistry,
  deps: EventRouteDeps,
): void {
  const { eventRepo } = deps;

  // 6. postProductEvents — POST /events (requireActor, 202)
  registry.register('postProductEvents', async (ctx: RouteContext) => {
    toRepoActor(ctx.actor);
    const body = validateBody(batchSchema, ctx.body);

    const inputs: ProductEventInput[] = body.events.map((e) => ({
      sessionId: e.analytics_session_id,
      eventName: e.event_name,
      attributes: e.attributes,
      actorKind: ctx.actor.kind === 'user' ? 'user' : 'guest',
      userId: ctx.actor.userId,
      guestSessionId: ctx.actor.guestSessionId,
      eventId: e.event_id,
      eventSchemaVersion: e.event_schema_version,
      occurredAt: e.occurred_at,
      environment: e.environment,
      appVersion: e.app_version,
      mode: e.mode,
      sourceKind: e.source_kind,
      actorKey: e.actor_key,
      stage: e.stage ?? null,
      experimentId: e.experiment_id ?? null,
    }));

    const result = eventRepo.batchCreate(inputs);
    return {
      data: {
        accepted_count: result.accepted,
        rejected_count: result.rejected,
        duplicates_count: result.duplicates,
      },
      meta: {},
      statusCode: 202,
    };
  });

  // 7. getQuickCompletionRate — GET /metrics/quick-completion-rate (requireActor=user)
  registry.register(
    'getQuickCompletionRate',
    async (ctx: RouteContext) => {
      // Metric endpoint is user-only (OpenAPI security: bearerAuth/cookieAuth).
      if (ctx.actor.kind !== 'user' || !ctx.actor.userId) {
        throw ApiError.unauthenticated();
      }
      const observationWindow =
        (ctx.query.observation_window as string | undefined) ?? '7d';
      const days = parseObservationWindow(observationWindow);
      const endDate = now();
      const startDate = addDays(endDate, -days);
      const sourceKind =
        (ctx.query.source_kind as string | undefined) ?? 'custom';

      const result = eventRepo.getQuickCompletionRate({
        startDate,
        endDate,
        sourceKind,
      });

      return {
        metric_name: 'quick-completion-rate',
        numerator: result.numerator,
        denominator: result.denominator,
        observation_window: observationWindow,
        sample_size: result.denominator,
        filters: {
          source_kind: sourceKind,
          environment_exclude: ['internal_test'],
        },
        calculated_at: endDate,
      };
    },
    { requireActor: 'user' },
  );
}
