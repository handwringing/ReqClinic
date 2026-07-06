import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

import { RouteRegistry, type RouteContext } from '../../../src/http/route-registry';
import { loadOpenApi, type OperationSpec, toRoutePath } from '../../../src/http/openapi-loader';
import { createAuthMiddleware } from '../../../src/http/middleware/auth';
import { createAgreementGate } from '../../../src/http/middleware/agreement-gate';
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
} from '../../../src/http/routes/v1';
import { createTestDb, type AppDb } from '../../helpers/test-db';

import { UserRepo } from '../../../src/repo/user-repo';
import { GuestSessionRepo } from '../../../src/repo/guest-session-repo';
import { AgreementRepo } from '../../../src/repo/agreement-repo';
import { ProjectRepo } from '../../../src/repo/project-repo';
import { MemberRepo } from '../../../src/repo/member-repo';
import { IntakeRepo } from '../../../src/repo/intake-repo';
import { SourceRepo } from '../../../src/repo/source-repo';
import { EvidenceRepo } from '../../../src/repo/evidence-repo';
import { QuickSessionRepo } from '../../../src/repo/quick-session-repo';
import { QuickTurnRepo } from '../../../src/repo/quick-turn-repo';
import { QuickUnknownRepo } from '../../../src/repo/quick-unknown-repo';
import { BriefRepo } from '../../../src/repo/brief-repo';
import { UpgradeRepo } from '../../../src/repo/upgrade-repo';
import { OutcomeRepo, buildOutcomeRow } from '../../../src/repo/outcome-repo';
import { DriverRepo } from '../../../src/repo/driver-repo';
import { RequirementRepo, buildRequirementRow } from '../../../src/repo/requirement-repo';
import { AcceptanceRepo } from '../../../src/repo/acceptance-repo';
import { SignalRepo } from '../../../src/repo/signal-repo';
import { ScenarioRepo } from '../../../src/repo/scenario-repo';
import { ConflictRepo } from '../../../src/repo/conflict-repo';
import { StakeholderRepo } from '../../../src/repo/stakeholder-repo';
import { EvidenceLinkRepo } from '../../../src/repo/evidence-link-repo';
import { BaselineRepo } from '../../../src/repo/baseline-repo';
import { VerificationRepo } from '../../../src/repo/verification-repo';
import { ReviewRepo } from '../../../src/repo/review-repo';
import { DomainProfileRepo } from '../../../src/repo/domain-repo';
import { JobRepo } from '../../../src/repo/job-repo';
import { TrainingRepo } from '../../../src/repo/training-repo';
import { EventRepo } from '../../../src/repo/event-repo';
import { ReportRepo } from '../../../src/repo/report-repo';
import { ChangeRepo } from '../../../src/repo/change-repo';
import { FormalMapRepo } from '../../../src/repo/formal-map-repo';

import { agreementVersions } from '../../../src/db/schema/identity';
import { outcomes, requirements, conflicts, conflictOptions, stakeholders } from '../../../src/db/schema/core';
import { domainProfiles } from '../../../src/db/schema/domain';
import { trainingCases } from '../../../src/db/schema/training';
import { reportTemplates } from '../../../src/db/schema/report';
import { env } from '../../../src/config/env';
import { now } from '../../../src/shared/time';
import { generateId } from '../../../src/shared/id';

/**
 * Contract-test fixture bundle.
 *
 * Registers every one of the 106 v1 operationIds onto a single Fastify app
 * wired to an in-memory SQLite database, the auth middleware (cookie-based
 * actor resolution) and the agreement gate (consent enforcement). Seeds
 * enough cross-domain data (user, guest, project, driver, outcome,
 * requirement, conflict, baseline, domain profile, training case, quick
 * session, report template) that every route is reachable and returns a
 * contract-shaped response rather than a Fastify routing 404.
 */
export interface ContractFixtures {
  app: FastifyInstance;
  db: AppDb;
  inject: (
    method: string,
    url: string,
    opts?: {
      body?: unknown;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
      query?: Record<string, string | string[]>;
    },
  ) => Promise<{ statusCode: number; body: any; headers: Record<string, string> }>;
  /** Auth cookie helper for the seeded owner. */
  asOwner: (extra?: Record<string, string>) => { cookies: Record<string, string> };
  /** Auth cookie helper for the seeded non-member. */
  asOutsider: () => { cookies: Record<string, string> };
  // Fixture IDs.
  ownerId: string;
  outsiderId: string;
  guestSessionKey: string;
  guestSessionId: string;
  agreementVersionId: string;
  projectId: string;
  driverId: string;
  outcomeId: string;
  requirementId: string;
  conflictId: string;
  conflictOptionId: string;
  baselineId: string;
  quickSessionId: string;
  trainingCaseId: string;
  trainingAttemptId: string;
  reportTemplateId: string;
}

export async function buildContractApp(): Promise<ContractFixtures> {
  const db = createTestDb();

  const app = Fastify({ logger: false });
  await app.register(cookie);

  // ── Repos ────────────────────────────────────────────────────────────────
  const userRepo = new UserRepo(db.db);
  const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);
  const agreementRepo = new AgreementRepo(db.db);
  const projectRepo = new ProjectRepo(db.db);
  const memberRepo = new MemberRepo(db.db);
  const intakeRepo = new IntakeRepo(db.db);
  const sourceRepo = new SourceRepo(db.db);
  const evidenceRepo = new EvidenceRepo(db.db);
  const quickSessionRepo = new QuickSessionRepo(db.db);
  const quickTurnRepo = new QuickTurnRepo(db.db);
  const quickUnknownRepo = new QuickUnknownRepo(db.db);
  const briefRepo = new BriefRepo(db.db);
  const upgradeRepo = new UpgradeRepo(db.db);
  const outcomeRepo = new OutcomeRepo(db.db);
  const driverRepo = new DriverRepo(db.db);
  const requirementRepo = new RequirementRepo(db.db);
  const acceptanceRepo = new AcceptanceRepo(db.db);
  const signalRepo = new SignalRepo(db.db);
  const scenarioRepo = new ScenarioRepo(db.db);
  const conflictRepo = new ConflictRepo(db.db);
  const stakeholderRepo = new StakeholderRepo(db.db);
  const evidenceLinkRepo = new EvidenceLinkRepo(db.db);
  const baselineRepo = new BaselineRepo(db.db);
  const verificationRepo = new VerificationRepo(db.db);
  const reviewRepo = new ReviewRepo(db.db);
  const domainProfileRepo = new DomainProfileRepo(db.db);
  const jobRepo = new JobRepo(db.db);
  const trainingRepo = new TrainingRepo(db.db);
  const eventRepo = new EventRepo(db.db);
  const reportRepo = new ReportRepo(db.db);
  const changeRepo = new ChangeRepo(db.db);
  const formalMapRepo = new FormalMapRepo(db.db);

  const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
  const agreementGate = createAgreementGate({ agreementRepo });

  // ── Register every v1 route module ───────────────────────────────────────
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

  await registry.applyTo(app, db, {
    resolveActor: auth.resolveActor,
    checkAgreement: (ctx: RouteContext) => agreementGate.checkAgreement(ctx.actor),
  });
  await app.ready();

  // ── Seed users ───────────────────────────────────────────────────────────
  const owner = await userRepo.create({
    displayName: 'Contract Owner',
    authSubject: 'auth|contract-owner',
    email: 'contract-owner@example.com',
  });
  const ownerId = owner.id;

  const outsider = await userRepo.create({
    displayName: 'Contract Outsider',
    authSubject: 'auth|contract-outsider',
    email: 'contract-outsider@example.com',
  });
  const outsiderId = outsider.id;

  // ── Seed agreement version + consent for owner ───────────────────────────
  const agreementVersionId = generateId('agrv');
  const ts = now();
  await db.db.insert(agreementVersions).values({
    id: agreementVersionId,
    version: '1.0.0',
    status: 'active',
    changeType: 'major',
    effectiveAt: ts,
    contentRef: 'test://agreement.md',
    createdAt: ts,
  });
  await agreementRepo.createConsent({
    agreementVersionId,
    actorKind: 'user',
    userId: ownerId,
  });

  // ── Seed guest session with consent ──────────────────────────────────────
  const guestSession = await guestSessionRepo.create();
  const guestSessionKey = guestSession.sessionKey;
  const guestSessionId = guestSession.id;
  await agreementRepo.createConsent({
    agreementVersionId,
    actorKind: 'guest',
    guestSessionId,
  });

  // ── Seed project (Owner gets full capabilities) ──────────────────────────
  const project = projectRepo.create({ ownerId, name: '契约测试项目' });
  const projectId = project.id;

  // Approved domain profile (so the project looks analyzed).
  seedApprovedDomainProfile(db, projectId, ownerId);

  // ── Seed core entities ───────────────────────────────────────────────────
  const driver = driverRepo.create({
    projectId,
    driverType: 'goal',
    statement: '契约测试驱动',
  });
  const driverId = driver.id;

  const outcomeRow = buildOutcomeRow({
    projectId,
    driverId,
    description: '契约测试成果',
    epistemicType: 'Inference',
  });
  db.db.insert(outcomes).values(outcomeRow).run();
  const outcomeId = outcomeRow.id!;

  const reqRow = buildRequirementRow({
    projectId,
    requirementKey: 'REQ-CONTRACT-001',
    statement: '契约测试需求',
    requirementType: 'functional',
    provenance: 'explicitly_stated',
    commitment: 'committed',
    stability: 'stable',
  });
  db.db.insert(requirements).values(reqRow).run();
  const requirementId = reqRow.id!;

  const conflictId = generateId('cfl');
  const conflictOptionId = generateId('opt');
  db.db.insert(conflicts).values({
    id: conflictId,
    projectId,
    statement: '契约测试冲突',
    severity: 'medium',
    blocking: 0,
    ownerId: null,
    status: 'open',
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  db.db.insert(conflictOptions).values({
    id: conflictOptionId,
    conflictId,
    description: '契约测试选项',
    benefits: '收益',
    costs: '成本',
    risks: '风险',
    reversibility: 'medium',
    status: 'candidate',
    createdAt: ts,
    updatedAt: ts,
  }).run();

  db.db.insert(stakeholders).values({
    id: generateId('stk'),
    projectId,
    name: '契约测试利益相关方',
    role: '决策者',
    epistemicType: 'Fact',
    status: 'candidate',
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  }).run();

  // ── Seed an approved baseline ────────────────────────────────────────────
  const baseline = baselineRepo.create({
    projectId,
    items: [
      { entityType: 'requirement', entityId: requirementId, entityVersion: 1 },
      { entityType: 'outcome', entityId: outcomeId, entityVersion: 1 },
    ],
  });
  const baselineId = baselineRepo.approve({
    id: baseline.id,
    approverId: ownerId,
    expectedVersion: baseline.version,
  }).id;

  // ── Seed a quick session owned by the owner ──────────────────────────────
  const quickSession = quickSessionRepo.create({
    actorKind: 'user',
    userId: ownerId,
    sourceKind: 'custom',
    originalIdea: '契约测试快速问诊',
  });
  const quickSessionId = quickSession.id;

  // ── Seed a training case + attempt ───────────────────────────────────────
  const trainingCaseId = 'TC_contract_001';
  const trainingCaseVersion = '1.0.0';
  db.db.insert(trainingCases).values({
    id: generateId('tcase'),
    caseId: trainingCaseId,
    version: trainingCaseVersion,
    title: '契约测试训练案例',
    difficulty: 'medium',
    scenarioJson: JSON.stringify({ category: 'software', scene: 'scene-1' }),
    disclosureRulesJson: JSON.stringify([{ id: 'r1', disclose: 'goal' }]),
    rubricJson: JSON.stringify({
      answer_key: null,
      evaluation_dimensions: ['target_clarification'],
    }),
    status: 'active',
    createdAt: ts,
  }).run();
  const attempt = trainingRepo.createAttempt({
    caseId: trainingCaseId,
    caseVersion: trainingCaseVersion,
    actorKind: 'user',
    userId: ownerId,
  });
  const trainingAttemptId = attempt.id;

  // ── Seed a report template ───────────────────────────────────────────────
  const reportTemplateId = 'tmpl_standard';
  db.db.insert(reportTemplates).values({
    id: reportTemplateId,
    audience: 'executive',
    version: '1.0.0',
    contentHash: 'sha256:template',
    status: 'active',
    createdAt: ts,
  }).run();

  // ── inject helper ────────────────────────────────────────────────────────
  const inject = async (
    method: string,
    url: string,
    opts: {
      body?: unknown;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
      query?: Record<string, string | string[]>;
    } = {},
  ) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.inject({
      method,
      url,
      payload: opts.body as string | object | undefined,
      headers,
      cookies: opts.cookies,
      query: opts.query,
    });
    let body: any = res.body;
    const ct = res.headers['content-type'];
    if (typeof ct === 'string' && ct.includes('application/json')) {
      try {
        body = JSON.parse(res.body);
      } catch {
        body = res.body;
      }
    }
    return {
      statusCode: res.statusCode,
      body,
      headers: res.headers as Record<string, string>,
    };
  };

  const asOwner = (extra: Record<string, string> = {}) => ({
    cookies: { auth_session: ownerId, ...extra },
  });
  const asOutsider = () => ({ cookies: { auth_session: outsiderId } });

  return {
    app,
    db,
    inject,
    asOwner,
    asOutsider,
    ownerId,
    outsiderId,
    guestSessionKey,
    guestSessionId,
    agreementVersionId,
    projectId,
    driverId,
    outcomeId,
    requirementId,
    conflictId,
    conflictOptionId,
    baselineId,
    quickSessionId,
    trainingCaseId,
    trainingAttemptId,
    reportTemplateId,
  };
}

/** Insert an approved domain profile directly (bypassing the AI flow). */
function seedApprovedDomainProfile(db: AppDb, projectId: string, ownerId: string): void {
  const id = generateId('dpr');
  const ts = now();
  db.db.insert(domainProfiles).values({
    id,
    projectId,
    profileVersion: 1,
    workType: 'software_delivery',
    domainLabelsJson: '[]',
    riskFlagsJson: '[]',
    terminologyMapJson: '{}',
    suggestedPackIdsJson: '["general"]',
    requiredHumanRolesJson: '[]',
    routingRisk: 'low',
    routingBasisJson: '{}',
    rationaleEvidenceLinksJson: '[]',
    unknownsJson: '[]',
    status: 'approved',
    classifierModel: 'stub-classifier-v1',
    promptVersion: 'prompt-v1.0.0',
    approvedBy: ownerId,
    approvedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  }).run();
}

// ── Path-param substitution ─────────────────────────────────────────────────

/**
 * Build a concrete request URL for `operationId` by substituting each
 * `{param}` in the OpenAPI path with a fixture value from `fx`.
 */
export function buildOperationUrl(operationId: string, fx: ContractFixtures): string {
  const spec = loadOpenApi().get(operationId);
  if (!spec) throw new Error(`Unknown operationId: ${operationId}`);
  const paramValues: Record<string, string> = {
    id: resolveIdParam(operationId, fx),
    versionId: fx.agreementVersionId,
    packId: 'software-delivery',
    version: '1.0.0',
    caseId: fx.trainingCaseId,
    gate: 'scope',
    viewType: 'simple',
    userId: fx.ownerId,
    reportId: 'rpt_nonexistent',
  };
  let url = toRoutePath(spec.path);
  for (const [param, value] of Object.entries(paramValues)) {
    url = url.replace(`:${param}`, encodeURIComponent(value));
  }
  return url;
}

/**
 * Resolve the generic `{id}` path parameter to the fixture ID that matches the
 * resource the operation targets (project, quick-session, driver, etc.).
 */
function resolveIdParam(operationId: string, fx: ContractFixtures): string {
  switch (operationId) {
    case 'getProject':
    case 'updateProject':
    case 'deleteProject':
    case 'createIntake':
    case 'listMembers':
    case 'addMember':
    case 'createAnalysisRun':
    case 'getDomainProfile':
    case 'reviewDomainProfile':
    case 'activateDomainPack':
    case 'previewDeactivation':
    case 'deactivateDomainPack':
    case 'createDriver':
    case 'createFutureScenario':
    case 'createBaseline':
    case 'listOutcomes':
    case 'listRequirements':
    case 'listDrivers':
    case 'listInterviewTurns':
    case 'listStakeholders':
    case 'listEvidenceLinks':
    case 'listTraceLinks':
    case 'listConflicts':
    case 'listBaselines':
    case 'listReports':
    case 'listChanges':
    case 'createChange':
    case 'createChangePreview':
    case 'compileReport':
    case 'listSources':
    case 'uploadSource':
      return fx.projectId;
    case 'getQuickSession':
    case 'deleteQuickSession':
    case 'listQuickSessionMessages':
    case 'postQuickSessionMessage':
    case 'getQuickSessionCoverage':
    case 'getQuickSessionUnderstanding':
    case 'listQuickSessionUnknowns':
    case 'reviewQuickSessionUnderstanding':
    case 'handleQuickSessionTopicChange':
    case 'recordQuickSessionOptionPreference':
    case 'listQuickSessionBriefVersions':
    case 'generateQuickSessionBrief':
    case 'getQuickSessionBriefVersion':
    case 'getBriefView':
    case 'exportQuickSessionBrief':
    case 'downloadQuickSessionBrief':
    case 'submitBriefUsefulnessFeedback':
    case 'abandonQuickSession':
    case 'archiveQuickSession':
    case 'upgradeQuickSession':
    case 'claimQuickSession':
      return fx.quickSessionId;
    case 'updateDriver':
    case 'reviewDriver':
      return fx.driverId;
    case 'updateOutcome':
    case 'reviewOutcome':
      return fx.outcomeId;
    case 'updateRequirement':
    case 'reviewRequirement':
    case 'listAcceptanceCriteria':
    case 'createAcceptanceCriterion':
    case 'listOperationalSignals':
    case 'createVerificationArtifact':
      return fx.requirementId;
    case 'getConflictDetail':
    case 'reviewConflict':
    case 'resolveConflict':
      return fx.conflictId;
    case 'approveBaseline':
      return fx.baselineId;
    case 'getJobStatus':
    case 'cancelJob':
      return 'job_nonexistent';
    case 'getTrainingAttempt':
    case 'completeTrainingAttempt':
    case 'retryTrainingAttempt':
    case 'getTrainingFeedback':
    case 'postTrainingQuestion':
    case 'postTrainingSummary':
      return fx.trainingAttemptId;
    case 'getChangeImpact':
    case 'confirmChange':
    case 'withdrawChange':
      return 'chg_nonexistent';
    case 'getChangePreviewImpact':
      return 'cprv_nonexistent';
    case 'getDeleteTask':
      return 'delt_nonexistent';
    case 'getEvidence':
      return 'evd_nonexistent';
    case 'getReport':
    case 'releaseReport':
    case 'downloadReport':
      return 'rpt_nonexistent';
    case 'downloadProjectReport':
      return fx.projectId; // {id} = project; {reportId} handled below
    default:
      return 'unknown_id';
  }
}

/** The 2xx success status declared by the OpenAPI spec for `operationId`. */
export function successStatus(spec: OperationSpec): number {
  const codes = Object.keys(spec.responses);
  const successCodes = codes
    .filter((c) => c.startsWith('2'))
    .map(Number)
    .sort((a, b) => a - b);
  return successCodes[0] ?? 200;
}

/** Whether the OpenAPI spec declares a required request body for `operationId`. */
export function hasRequiredBody(spec: OperationSpec): boolean {
  return spec.requestBody?.required === true;
}
