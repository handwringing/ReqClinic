import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { env } from './config/env';
import type { AppDb } from './db/client';
import { RouteRegistry } from './http/route-registry';
import { loadOpenApi } from './http/openapi-loader';
import { createAuthMiddleware } from './http/middleware/auth';
import { createAgreementGate } from './http/middleware/agreement-gate';
import { createIdempotencyMiddleware } from './http/middleware/idempotency';
import {
  registerAuthRoutes,
  registerGuestRoutes,
  registerAgreementRoutes,
  registerProjectRoutes,
  registerFormalRoutes,
  registerQuickRoutes,
  registerCoreQueryRoutes,
  registerCoreWriteRoutes,
  registerDomainRoutes,
  registerJobRoutes,
  registerTrainingRoutes,
  registerEventRoutes,
  registerReportRoutes,
  registerChangeRoutes,
} from './http/routes/v1';
import { UserRepo } from './repo/user-repo';
import { GuestSessionRepo } from './repo/guest-session-repo';
import { AgreementRepo } from './repo/agreement-repo';
import { ProjectRepo } from './repo/project-repo';
import { MemberRepo } from './repo/member-repo';
import { IntakeRepo } from './repo/intake-repo';
import { SourceRepo } from './repo/source-repo';
import { EvidenceRepo } from './repo/evidence-repo';
import { QuickSessionRepo } from './repo/quick-session-repo';
import { QuickTurnRepo } from './repo/quick-turn-repo';
import { QuickUnknownRepo } from './repo/quick-unknown-repo';
import { BriefRepo } from './repo/brief-repo';
import { UpgradeRepo } from './repo/upgrade-repo';
import { OutcomeRepo } from './repo/outcome-repo';
import { DriverRepo } from './repo/driver-repo';
import { RequirementRepo } from './repo/requirement-repo';
import { AcceptanceRepo } from './repo/acceptance-repo';
import { SignalRepo } from './repo/signal-repo';
import { ScenarioRepo } from './repo/scenario-repo';
import { ConflictRepo } from './repo/conflict-repo';
import { StakeholderRepo } from './repo/stakeholder-repo';
import { EvidenceLinkRepo } from './repo/evidence-link-repo';
import { BaselineRepo } from './repo/baseline-repo';
import { VerificationRepo } from './repo/verification-repo';
import { ReviewRepo } from './repo/review-repo';
import { DomainProfileRepo } from './repo/domain-repo';
import { JobRepo } from './repo/job-repo';
import { TrainingRepo } from './repo/training-repo';
import { EventRepo } from './repo/event-repo';
import { ReportRepo } from './repo/report-repo';
import { ChangeRepo } from './repo/change-repo';
import { IdempotencyRepo } from './repo/idempotency-repo';
import { FormalMapRepo } from './repo/formal-map-repo';

export interface AppDeps {
  /** Database handle injected by the server (production) or tests. */
  db?: AppDb;
  /** Reserved for future test overrides (e.g. stubbed AI provider). */
  overrides?: Record<string, unknown>;
}

/**
 * Build the Fastify logger config per environment.
 * - test: logging disabled to keep test output quiet.
 * - production: structured JSON at the configured level.
 * - development: pretty-printed via pino-pretty.
 */
function buildLogger(): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'test') return false;
  if (env.NODE_ENV === 'production') {
    return { level: env.LOG_LEVEL };
  }
  return {
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        colorize: true,
      },
    },
  };
}

/**
 * Register all domain routes onto `app`.
 */
export async function registerRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  if (!deps.db) return;

  const userRepo = new UserRepo(deps.db.db);
  const guestSessionRepo = new GuestSessionRepo(deps.db.db, env.SERVER_PEPPER);
  const agreementRepo = new AgreementRepo(deps.db.db);
  const projectRepo = new ProjectRepo(deps.db.db);
  const memberRepo = new MemberRepo(deps.db.db);
  const intakeRepo = new IntakeRepo(deps.db.db);
  const sourceRepo = new SourceRepo(deps.db.db);
  const evidenceRepo = new EvidenceRepo(deps.db.db);
  const quickSessionRepo = new QuickSessionRepo(deps.db.db);
  const quickTurnRepo = new QuickTurnRepo(deps.db.db);
  const quickUnknownRepo = new QuickUnknownRepo(deps.db.db);
  const briefRepo = new BriefRepo(deps.db.db);
  const upgradeRepo = new UpgradeRepo(deps.db.db);
  const outcomeRepo = new OutcomeRepo(deps.db.db);
  const driverRepo = new DriverRepo(deps.db.db);
  const requirementRepo = new RequirementRepo(deps.db.db);
  const acceptanceRepo = new AcceptanceRepo(deps.db.db);
  const signalRepo = new SignalRepo(deps.db.db);
  const scenarioRepo = new ScenarioRepo(deps.db.db);
  const conflictRepo = new ConflictRepo(deps.db.db);
  const stakeholderRepo = new StakeholderRepo(deps.db.db);
  const evidenceLinkRepo = new EvidenceLinkRepo(deps.db.db);
  const baselineRepo = new BaselineRepo(deps.db.db);
  const verificationRepo = new VerificationRepo(deps.db.db);
  const reviewRepo = new ReviewRepo(deps.db.db);
  const domainProfileRepo = new DomainProfileRepo(deps.db.db);
  const jobRepo = new JobRepo(deps.db.db);
  const trainingRepo = new TrainingRepo(deps.db.db);
  const eventRepo = new EventRepo(deps.db.db);
  const reportRepo = new ReportRepo(deps.db.db);
  const changeRepo = new ChangeRepo(deps.db.db);
  const idempotencyRepo = new IdempotencyRepo(deps.db.db);
  const formalMapRepo = new FormalMapRepo(deps.db.db);

  const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
  const agreementGate = createAgreementGate({ agreementRepo });
  const idempotency = createIdempotencyMiddleware({ idempotencyRepo });

  const registry = new RouteRegistry(loadOpenApi());
  registerAuthRoutes(registry, { userRepo, guestSessionRepo });
  registerGuestRoutes(registry, { guestSessionRepo, quickSessionRepo });
  registerAgreementRoutes(registry, { agreementRepo, jobRepo });
  registerProjectRoutes(registry, {
    projectRepo,
    memberRepo,
    intakeRepo,
    sourceRepo,
    evidenceRepo,
    userRepo,
    agreementRepo,
    jobRepo,
    formalMapRepo,
  });
  registerFormalRoutes(registry, {
    userRepo,
    agreementRepo,
    projectRepo,
    formalMapRepo,
    jobRepo,
  });
  registerQuickRoutes(registry, {
    quickSessionRepo,
    quickTurnRepo,
    quickUnknownRepo,
    briefRepo,
    upgradeRepo,
    projectRepo,
    memberRepo,
    intakeRepo,
    jobRepo,
    userRepo,
    agreementRepo,
  });
  registerCoreQueryRoutes(registry, {
    outcomeRepo,
    driverRepo,
    requirementRepo,
    acceptanceRepo,
    signalRepo,
    scenarioRepo,
    conflictRepo,
    stakeholderRepo,
    evidenceLinkRepo,
    baselineRepo,
  });
  registerCoreWriteRoutes(registry, {
    driverRepo,
    outcomeRepo,
    requirementRepo,
    acceptanceRepo,
    verificationRepo,
    scenarioRepo,
    conflictRepo,
    reviewRepo,
    projectRepo,
  });
  registerDomainRoutes(registry, { domainProfileRepo });
  registerJobRoutes(registry, { jobRepo });
  registerTrainingRoutes(registry, { trainingRepo, jobRepo });
  registerEventRoutes(registry, { eventRepo });
  registerReportRoutes(registry, { baselineRepo, reportRepo });
  registerChangeRoutes(registry, { changeRepo, baselineRepo });

  await registry.applyTo(app, deps.db, {
    resolveActor: auth.resolveActor,
    checkAgreement: (ctx) => agreementGate.checkAgreement(ctx.actor),
    enforceIdempotency: idempotency.enforceIdempotency,
    storeIdempotency: idempotency.storeIdempotency,
  });
}

/**
 * Build (but do not listen on) a Fastify application.
 *
 * Accepts an optional injected database so tests can supply an isolated
 * in-memory SQLite instance.
 */
export async function buildApp(opts?: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: buildLogger() });

  app.register(cookie);
  app.register(cors, { origin: true, credentials: true });

  app.get('/health', async () => ({
    status: 'ok',
    ai: {
      provider: env.AI_PROVIDER,
      model:
        env.AI_PROVIDER === 'openai_compatible'
          ? env.OPENAI_COMPAT_MODEL
          : env.AI_PROVIDER === 'ollama'
            ? env.OLLAMA_MODEL
            : 'quick-runtime-fallback',
      model_api_ready:
        env.AI_PROVIDER === 'ollama' ||
        (env.AI_PROVIDER === 'openai_compatible' && Boolean(env.OPENAI_COMPAT_API_KEY)),
      requires_api_key: env.AI_PROVIDER === 'openai_compatible',
      api_key_configured:
        env.AI_PROVIDER === 'openai_compatible'
          ? Boolean(env.OPENAI_COMPAT_API_KEY)
          : null,
    },
  }));

  await registerRoutes(app, { db: opts?.db, overrides: opts?.overrides });
  await app.ready();

  return app;
}
