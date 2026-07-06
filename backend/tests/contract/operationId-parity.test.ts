import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RouteRegistry } from '../../src/http/route-registry';
import { loadOpenApi } from '../../src/http/openapi-loader';
import { createTestDb } from '../helpers/test-db';
import { env } from '../../src/config/env';
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
} from '../../src/http/routes/v1';

import { UserRepo } from '../../src/repo/user-repo';
import { GuestSessionRepo } from '../../src/repo/guest-session-repo';
import { AgreementRepo } from '../../src/repo/agreement-repo';
import { ProjectRepo } from '../../src/repo/project-repo';
import { MemberRepo } from '../../src/repo/member-repo';
import { IntakeRepo } from '../../src/repo/intake-repo';
import { SourceRepo } from '../../src/repo/source-repo';
import { EvidenceRepo } from '../../src/repo/evidence-repo';
import { QuickSessionRepo } from '../../src/repo/quick-session-repo';
import { QuickTurnRepo } from '../../src/repo/quick-turn-repo';
import { QuickUnknownRepo } from '../../src/repo/quick-unknown-repo';
import { BriefRepo } from '../../src/repo/brief-repo';
import { UpgradeRepo } from '../../src/repo/upgrade-repo';
import { OutcomeRepo } from '../../src/repo/outcome-repo';
import { DriverRepo } from '../../src/repo/driver-repo';
import { RequirementRepo } from '../../src/repo/requirement-repo';
import { AcceptanceRepo } from '../../src/repo/acceptance-repo';
import { SignalRepo } from '../../src/repo/signal-repo';
import { ScenarioRepo } from '../../src/repo/scenario-repo';
import { ConflictRepo } from '../../src/repo/conflict-repo';
import { StakeholderRepo } from '../../src/repo/stakeholder-repo';
import { EvidenceLinkRepo } from '../../src/repo/evidence-link-repo';
import { BaselineRepo } from '../../src/repo/baseline-repo';
import { VerificationRepo } from '../../src/repo/verification-repo';
import { ReviewRepo } from '../../src/repo/review-repo';
import { DomainProfileRepo } from '../../src/repo/domain-repo';
import { JobRepo } from '../../src/repo/job-repo';
import { TrainingRepo } from '../../src/repo/training-repo';
import { EventRepo } from '../../src/repo/event-repo';
import { ReportRepo } from '../../src/repo/report-repo';
import { ChangeRepo } from '../../src/repo/change-repo';
import { FormalMapRepo } from '../../src/repo/formal-map-repo';

/**
 * operationId three-way parity contract (Task 31).
 *
 * Asserts that the operationId sets declared by the OpenAPI spec, registered by
 * the backend RouteRegistry, and exposed by the frontend ApiClient are strictly
 * equal. The OpenAPI spec (`docs/03-api-openapi.yaml`) is the single source of
 * truth; both the backend and the frontend must cover every declared operation
 * with no extras.
 *
 * The frontend ApiClient passes the operationId verbatim as the first argument
 * to `transport.request('<operationId>', ...)` — method names equal operationIds
 * — so the parity check parses those string literals out of `client.ts`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/tests/contract → backend → repo root → ReqClinic/lib/api/client.ts
const FRONTEND_CLIENT_PATH = resolve(
  __dirname,
  '../../../ReqClinic/lib/api/client.ts',
);

const EXPECTED_OPERATION_COUNT = 108;

/** Parse the frontend ApiClient source and collect every operationId literal
 *  passed to `transport.request('<id>', ...)`. */
function extractFrontendOperationIds(): Set<string> {
  const src = readFileSync(FRONTEND_CLIENT_PATH, 'utf8');
  const ids = new Set<string>();
  const re = /transport\.request(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

/** Instantiate every v1 route module against a fresh in-memory DB and return
 *  the operationIds the registry ends up with. */
function registerAllRoutes(): string[] {
  const db = createTestDb();
  const registry = new RouteRegistry(loadOpenApi());

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
  registerTrainingRoutes(registry, { trainingRepo });
  registerEventRoutes(registry, { eventRepo });
  registerReportRoutes(registry, { baselineRepo, reportRepo });
  registerChangeRoutes(registry, { changeRepo, baselineRepo });

  return registry.getRegisteredIds();
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((id) => !b.has(id)).sort();
}

describe('operationId three-way parity (Task 31)', () => {
  it('OpenAPI spec declares exactly 106 operationIds', () => {
    const ops = loadOpenApi();
    expect(ops.size).toBe(EXPECTED_OPERATION_COUNT);
  });

  it('frontend ApiClient exposes exactly 106 operationIds', () => {
    const frontend = extractFrontendOperationIds();
    expect(frontend.size).toBe(EXPECTED_OPERATION_COUNT);
  });

  it('backend registers every OpenAPI operationId (no missing, no extra)', () => {
    const openApiIds = new Set(loadOpenApi().keys());
    const registered = new Set(registerAllRoutes());

    const missing = diff(openApiIds, registered); // in spec, not registered
    const extra = diff(registered, openApiIds); // registered, not in spec

    expect(
      { registeredCount: registered.size, missing, extra },
      `backend registration mismatch — missing: ${missing.join(', ') || '∅'}; extra: ${extra.join(', ') || '∅'}`,
    ).toEqual({ registeredCount: EXPECTED_OPERATION_COUNT, missing: [], extra: [] });
  });

  it('frontend ApiClient covers every OpenAPI operationId (no missing, no extra)', () => {
    const openApiIds = new Set(loadOpenApi().keys());
    const frontend = extractFrontendOperationIds();

    const missing = diff(openApiIds, frontend); // in spec, not in frontend
    const extra = diff(frontend, openApiIds); // in frontend, not in spec

    expect(
      { frontendCount: frontend.size, missing, extra },
      `frontend coverage mismatch — missing: ${missing.join(', ') || '∅'}; extra: ${extra.join(', ') || '∅'}`,
    ).toEqual({ frontendCount: EXPECTED_OPERATION_COUNT, missing: [], extra: [] });
  });

  it('backend and frontend operationId sets are identical', () => {
    const registered = new Set(registerAllRoutes());
    const frontend = extractFrontendOperationIds();

    const missingInFrontend = diff(registered, frontend);
    const extraInFrontend = diff(frontend, registered);

    expect(
      { missingInFrontend, extraInFrontend },
      `backend↔frontend mismatch — missing in frontend: ${missingInFrontend.join(', ') || '∅'}; extra in frontend: ${extraInFrontend.join(', ') || '∅'}`,
    ).toEqual({ missingInFrontend: [], extraInFrontend: [] });
  });
});
