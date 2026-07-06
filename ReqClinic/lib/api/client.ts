import type { ApiTransport } from './transport';
import { generateUUID } from '@/lib/utils/id';
import type {
  UUID,
  AuthSession,
  AsyncAcceptedResponse,
  GuestSession,
  Agreement,
  AgreementConsent,
  PaginationParams,
  PaginatedResponse,
  QuickSession,
  QuickSessionSourceKind,
  QuickSessionTurn,
  CoverageSlot,
  QuickSessionUnderstanding,
  QuickSessionUnknown,
  BriefViewType,
  BriefVersion,
  BriefView,
  BriefExport,
  BriefUsefulnessFeedback,
  TopicChangeAction,
  ReviewAction,
  ReviewActionRequest,
  ReviewActionEntity,
  GateReviewResponse,
  GateType,
  Project,
  ProjectSourceKind,
  ProjectStatus,
  FormalMapResponse,
  ProjectMember,
  Stakeholder,
  InterviewTurn,
  Source,
  EvidenceSpan,
  DeleteTask,
  DomainProfile,
  DomainPack,
  DomainPackVersionDetail,
  ActivateDomainPackRequest,
  ActivateDomainPackResponse,
  Outcome,
  Driver,
  Requirement,
  RequirementTier,
  AcceptanceCriterion,
  Conflict,
  Baseline,
  ReportSnapshot,
  ChangePreview,
  CreateChangePreviewRequest,
  ChangeImpact,
  GetChangeImpactResponse,
  Change,
  VerificationArtifact,
  CreateVerificationArtifactRequest,
  OperationalSignal,
  FutureScenario,
  CreateFutureScenarioRequest,
  EvidenceLink,
  TraceLink,
  TrainingCase,
  TrainingAttempt,
  TrainingAttemptSourceKind,
  TrainingFeedback,
  TrainingCaseVersionDetail,
  AiJob,
  ProductEvent,
  ProductEventBatchResponse,
  QuickCompletionRateResponse,
} from './types';

export class ApiClient {
  constructor(private transport: ApiTransport) {}

  // ===== 身份认证 =====
  async getAuthSession(options?: { signal?: AbortSignal }): Promise<AuthSession> {
    return this.transport.request<undefined, AuthSession>('getAuthSession', undefined, { signal: options?.signal });
  }

  async logout(options?: { signal?: AbortSignal }): Promise<void> {
    return this.transport.request<undefined, void>('logout', undefined, { signal: options?.signal });
  }

  async startAccountRecovery(
    request: { email?: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request<{ email?: string }, AsyncAcceptedResponse>('startAccountRecovery', request, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  // ===== 游客会话 =====
  async createGuestSession(
    request: { session_key_hash?: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<GuestSession> {
    return this.transport.request<{ session_key_hash?: string }, GuestSession>('createGuestSession', request, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async getCurrentGuestSession(options?: { signal?: AbortSignal }): Promise<GuestSession> {
    return this.transport.request<undefined, GuestSession>('getCurrentGuestSession', undefined, { signal: options?.signal });
  }

  async claimQuickSession(
    request: { guest_session_id: UUID; quick_session_id: UUID },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<QuickSession> {
    return this.transport.request<{ guest_session_id: UUID; quick_session_id: UUID }, QuickSession>('claimQuickSession', request, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  // ===== 协议同意 =====
  async getActiveAgreement(
    request: { scope: 'quick' | 'formal' | 'training' },
    options?: { signal?: AbortSignal }
  ): Promise<Agreement> {
    return this.transport.request<{ scope: 'quick' | 'formal' | 'training' }, Agreement>('getActiveAgreement', request, { signal: options?.signal });
  }

  async acceptAgreement(
    request: { agreement_id: UUID; scope: 'quick' | 'formal' | 'training' },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AgreementConsent> {
    return this.transport.request<{ agreement_id: UUID; scope: 'quick' | 'formal' | 'training' }, AgreementConsent>('acceptAgreement', request, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async reacceptAgreement(
    request: { agreement_id: UUID; scope: 'quick' | 'formal' | 'training' },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AgreementConsent> {
    return this.transport.request<{ agreement_id: UUID; scope: 'quick' | 'formal' | 'training' }, AgreementConsent>('reacceptAgreement', request, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async withdrawAgreementConsent(
    request: { consent_id: UUID },
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.transport.request<{ consent_id: UUID }, void>('withdrawAgreementConsent', request, { signal: options?.signal });
  }

  async listAgreementConsents(
    request: { scope?: 'quick' | 'formal' | 'training' } & PaginationParams,
    options?: { signal?: AbortSignal }
  ): Promise<PaginatedResponse<AgreementConsent>> {
    return this.transport.request('listAgreementConsents', request, { signal: options?.signal });
  }

  // ===== 快速问诊 =====
  async createQuickSession(
    request: { original_input: string; source_kind?: QuickSessionSourceKind; source_case_id?: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<QuickSession> {
    return this.transport.request('createQuickSession', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getQuickSession(id: UUID, options?: { signal?: AbortSignal }): Promise<QuickSession> {
    return this.transport.request<{ id: UUID }, QuickSession>('getQuickSession', { id }, { signal: options?.signal });
  }

  async deleteQuickSession(id: UUID, options?: { signal?: AbortSignal }): Promise<DeleteTask> {
    return this.transport.request<{ id: UUID }, DeleteTask>('deleteQuickSession', { id }, { signal: options?.signal });
  }

  async listQuickSessionMessages(id: UUID, request: PaginationParams, options?: { signal?: AbortSignal }): Promise<PaginatedResponse<QuickSessionTurn>> {
    return this.transport.request('listQuickSessionMessages', { id, ...request }, { signal: options?.signal });
  }

  async postQuickSessionMessage(
    request: {
      session_id: UUID;
      content: string;
      bound_refs?: Array<{ card_id: string; card_title: string; card_version?: string | null }>;
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse & { project_id?: UUID; status_url?: string }> {
    return this.transport.request('postQuickSessionMessage', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getQuickSessionCoverage(session_id: UUID, options?: { signal?: AbortSignal }): Promise<CoverageSlot[]> {
    return this.transport.request<{ session_id: UUID }, CoverageSlot[]>('getQuickSessionCoverage', { session_id }, { signal: options?.signal });
  }

  async getQuickSessionUnderstanding(session_id: UUID, options?: { signal?: AbortSignal }): Promise<QuickSessionUnderstanding> {
    return this.transport.request<{ session_id: UUID }, QuickSessionUnderstanding>('getQuickSessionUnderstanding', { session_id }, { signal: options?.signal });
  }

  async listQuickSessionUnknowns(session_id: UUID, options?: { signal?: AbortSignal }): Promise<QuickSessionUnknown[]> {
    return this.transport.request<{ session_id: UUID }, QuickSessionUnknown[]>('listQuickSessionUnknowns', { session_id }, { signal: options?.signal });
  }

  async reviewQuickSessionUnderstanding(
    request: { session_id: UUID; action: ReviewAction; after_value?: Record<string, unknown> },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('reviewQuickSessionUnderstanding', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async handleQuickSessionTopicChange(
    request: { session_id: UUID; new_input: string; action: TopicChangeAction },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<QuickSession> {
    return this.transport.request('handleQuickSessionTopicChange', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async recordQuickSessionOptionPreference(
    request: { session_id: UUID; option_id: UUID; is_preferred: boolean },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('recordQuickSessionOptionPreference', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async listQuickSessionBriefVersions(session_id: UUID, options?: { signal?: AbortSignal }): Promise<BriefVersion[]> {
    return this.transport.request<{ session_id: UUID }, BriefVersion[]>('listQuickSessionBriefVersions', { session_id }, { signal: options?.signal });
  }

  async generateQuickSessionBrief(
    request: { session_id: UUID; view_type?: BriefViewType },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('generateQuickSessionBrief', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getQuickSessionBriefVersion(session_id: UUID, version: number, options?: { signal?: AbortSignal }): Promise<BriefVersion> {
    return this.transport.request<{ session_id: UUID; version: number }, BriefVersion>('getQuickSessionBriefVersion', { session_id, version }, { signal: options?.signal });
  }

  async getBriefView(
    request: { session_id: UUID; brief_version: number; view_type: BriefViewType },
    options?: { signal?: AbortSignal }
  ): Promise<BriefView> {
    return this.transport.request('getBriefView', request, { signal: options?.signal });
  }

  async exportQuickSessionBrief(
    request: { session_id: UUID; brief_version: number; formats: string[] },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<BriefExport> {
    return this.transport.request('exportQuickSessionBrief', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async downloadQuickSessionBrief(
    request: { export_id: UUID; format: string },
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    return this.transport.request<{ export_id: UUID; format: string }, string>('downloadQuickSessionBrief', request, { signal: options?.signal });
  }

  async submitBriefUsefulnessFeedback(
    request: { session_id: UUID; brief_version: number; feedback: BriefUsefulnessFeedback },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<void> {
    return this.transport.request('submitBriefUsefulnessFeedback', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async abandonQuickSession(id: UUID, options?: { signal?: AbortSignal }): Promise<QuickSession> {
    return this.transport.request<{ id: UUID }, QuickSession>('abandonQuickSession', { id }, { signal: options?.signal });
  }

  async archiveQuickSession(id: UUID, options?: { signal?: AbortSignal }): Promise<QuickSession> {
    return this.transport.request<{ id: UUID }, QuickSession>('archiveQuickSession', { id }, { signal: options?.signal });
  }

  async upgradeQuickSession(
    request: {
      session_id: UUID;
      title: string;
      brief_version?: number;
      expected_quick_session_version?: number;
      source_kind?: ProjectSourceKind;
      source_case_id?: string | null;
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse & { project_id?: UUID; upgraded?: boolean; title?: string }> {
    return this.transport.request('upgradeQuickSession', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  // ===== 正式项目 =====
  async createProject(
    request: {
      title: string;
      initial_request: string;
      description?: string;
      decision_intent?: string | null;
      selected_work_type?: string | null;
      candidate_roles?: string[];
      candidate_constraints?: string[];
      source_kind?: ProjectSourceKind;
      source_case_id?: string | null;
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse & { project_id?: UUID }> {
    return this.transport.request('createProject', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getProject(id: UUID, options?: { signal?: AbortSignal }): Promise<Project> {
    return this.transport.request<{ id: UUID }, Project>('getProject', { id }, { signal: options?.signal });
  }

  async getFormalMapSnapshot(project_id: UUID, options?: { signal?: AbortSignal }): Promise<FormalMapResponse> {
    return this.transport.request<{ project_id: UUID }, FormalMapResponse>('getFormalMapSnapshot', { project_id }, { signal: options?.signal });
  }

  async postFormalProjectMessage(
    request: {
      project_id: UUID;
      content: string;
      bound_refs?: Array<{ id: string; title: string; detail?: string; kind?: string }>;
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('postFormalProjectMessage', request, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async updateProject(
    request: { id: UUID; title?: string; status?: ProjectStatus; expected_version: number },
    options?: { signal?: AbortSignal }
  ): Promise<Project> {
    return this.transport.request('updateProject', request, { signal: options?.signal });
  }

  async deleteProject(id: UUID, options?: { signal?: AbortSignal }): Promise<DeleteTask> {
    return this.transport.request<{ id: UUID }, DeleteTask>('deleteProject', { id }, { signal: options?.signal });
  }

  async getDeleteTask(id: UUID, options?: { signal?: AbortSignal }): Promise<DeleteTask> {
    return this.transport.request<{ id: UUID }, DeleteTask>('getDeleteTask', { id }, { signal: options?.signal });
  }

  async createIntake(
    request: { project_id: UUID; source_ids?: UUID[]; description?: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('createIntake', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async listMembers(project_id: UUID, options?: { signal?: AbortSignal }): Promise<ProjectMember[]> {
    return this.transport.request<{ project_id: UUID }, ProjectMember[]>('listMembers', { project_id }, { signal: options?.signal });
  }

  async listStakeholders(project_id: UUID, options?: { signal?: AbortSignal }): Promise<Stakeholder[]> {
    return this.transport.request<{ project_id: UUID }, Stakeholder[]>('listStakeholders', { project_id }, { signal: options?.signal });
  }

  async addMember(
    request: { project_id: UUID; user_id: UUID; role: 'owner' | 'analyst' | 'reviewer' | 'observer'; display_name: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ProjectMember> {
    return this.transport.request('addMember', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async updateMember(
    request: { project_id: UUID; member_id: UUID; role?: 'owner' | 'analyst' | 'reviewer' | 'observer'; display_name?: string },
    options?: { signal?: AbortSignal }
  ): Promise<ProjectMember> {
    return this.transport.request('updateMember', request, { signal: options?.signal });
  }

  // ===== 领域画像 =====
  async getDomainProfile(project_id: UUID, options?: { signal?: AbortSignal }): Promise<DomainProfile> {
    return this.transport.request<{ project_id: UUID }, DomainProfile>('getDomainProfile', { project_id }, { signal: options?.signal });
  }

  async reviewDomainProfile(
    request: { project_id: UUID; action: ReviewAction; reason?: string; after_value?: Record<string, unknown> },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('reviewDomainProfile', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async listDomainPacks(request: PaginationParams, options?: { signal?: AbortSignal }): Promise<PaginatedResponse<DomainPack>> {
    return this.transport.request('listDomainPacks', request, { signal: options?.signal });
  }

  async getDomainPackVersion(id: UUID, version: string, options?: { signal?: AbortSignal }): Promise<DomainPackVersionDetail> {
    return this.transport.request<{ id: UUID; version: string }, DomainPackVersionDetail>('getDomainPackVersion', { id, version }, { signal: options?.signal });
  }

  async activateDomainPack(
    project_id: UUID,
    pack_id: UUID,
    request: ActivateDomainPackRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ActivateDomainPackResponse> {
    return this.transport.request<ActivateDomainPackRequest & { project_id: UUID; pack_id: UUID }, ActivateDomainPackResponse>('activateDomainPack', { project_id, pack_id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async previewDeactivation(
    project_id: UUID,
    pack_id: UUID,
    request: { domain_pack_version: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<{ preview_id: string; impact: unknown[] }> {
    return this.transport.request<{ project_id: UUID; pack_id: UUID; domain_pack_version: string }, { preview_id: string; impact: unknown[] }>('previewDeactivation', { project_id, pack_id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async deactivateDomainPack(
    project_id: UUID,
    pack_id: UUID,
    request: { preview_id: string; domain_pack_version: string; expected_version: number },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<{ status: string }> {
    return this.transport.request<{ project_id: UUID; pack_id: UUID; preview_id: string; domain_pack_version: string; expected_version: number }, { status: string }>('deactivateDomainPack', { project_id, pack_id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  // ===== 来源证据 =====
  async uploadSource(
    project_id: UUID,
    request: { filename: string; mime_type: string; byte_size: number; sensitivity: 'public' | 'internal' | 'confidential' },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<Source> {
    return this.transport.request<{ project_id: UUID; filename: string; mime_type: string; byte_size: number; sensitivity: 'public' | 'internal' | 'confidential' }, Source>('uploadSource', { project_id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async getEvidence(source_id: UUID, options?: { signal?: AbortSignal }): Promise<EvidenceSpan[]> {
    return this.transport.request<{ source_id: UUID }, EvidenceSpan[]>('getEvidence', { source_id }, { signal: options?.signal });
  }

  async listSources(project_id: UUID, request: PaginationParams, options?: { signal?: AbortSignal }): Promise<PaginatedResponse<Source>> {
    return this.transport.request('listSources', { project_id, ...request }, { signal: options?.signal });
  }

  // ===== 分析作业 =====
  async createAnalysisRun(
    request: { project_id: UUID; analysis_type: string; params?: Record<string, unknown> },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('createAnalysisRun', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getJobStatus(job_id: UUID, options?: { signal?: AbortSignal }): Promise<AiJob> {
    return this.transport.request<{ job_id: UUID }, AiJob>('getJobStatus', { job_id }, { signal: options?.signal });
  }

  async cancelJob(job_id: UUID, options?: { signal?: AbortSignal }): Promise<AiJob> {
    return this.transport.request<{ job_id: UUID }, AiJob>('cancelJob', { job_id }, { signal: options?.signal });
  }

  // ===== 需求工程核心 =====
  async listOutcomes(project_id: UUID, request: PaginationParams, options?: { signal?: AbortSignal }): Promise<PaginatedResponse<Outcome>> {
    return this.transport.request('listOutcomes', { project_id, ...request }, { signal: options?.signal });
  }

  async updateOutcome(
    request: { id: UUID; title?: string; description?: string; status?: string; owner_id?: UUID; expected_version: number },
    options?: { signal?: AbortSignal }
  ): Promise<Outcome> {
    return this.transport.request('updateOutcome', request, { signal: options?.signal });
  }

  async listDrivers(project_id: UUID, request: PaginationParams, options?: { signal?: AbortSignal }): Promise<PaginatedResponse<Driver>> {
    return this.transport.request('listDrivers', { project_id, ...request }, { signal: options?.signal });
  }

  async createDriver(
    request: { project_id: UUID; code: string; title: string; description: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<Driver> {
    return this.transport.request('createDriver', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async updateDriver(
    request: { id: UUID; title?: string; description?: string; status?: string; expected_version: number },
    options?: { signal?: AbortSignal }
  ): Promise<Driver> {
    return this.transport.request('updateDriver', request, { signal: options?.signal });
  }

  async listRequirements(project_id: UUID, request: PaginationParams & { tier?: RequirementTier }, options?: { signal?: AbortSignal }): Promise<PaginatedResponse<Requirement>> {
    return this.transport.request('listRequirements', { project_id, ...request }, { signal: options?.signal });
  }

  async updateRequirement(
    request: { id: UUID; title?: string; description?: string; tier?: RequirementTier; status?: string; expected_version: number },
    options?: { signal?: AbortSignal }
  ): Promise<Requirement> {
    return this.transport.request('updateRequirement', request, { signal: options?.signal });
  }

  async listAcceptanceCriteria(requirement_id: UUID, options?: { signal?: AbortSignal }): Promise<AcceptanceCriterion[]> {
    return this.transport.request<{ requirement_id: UUID }, AcceptanceCriterion[]>('listAcceptanceCriteria', { requirement_id }, { signal: options?.signal });
  }

  async createAcceptanceCriterion(
    request: { requirement_id: UUID; given: string; when: string; then: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AcceptanceCriterion> {
    return this.transport.request('createAcceptanceCriterion', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async createVerificationArtifact(
    requirement_id: UUID,
    request: CreateVerificationArtifactRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<VerificationArtifact> {
    return this.transport.request<CreateVerificationArtifactRequest & { requirement_id: UUID }, VerificationArtifact>('createVerificationArtifact', { requirement_id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async listOperationalSignals(requirement_id: UUID, options?: { signal?: AbortSignal }): Promise<OperationalSignal[]> {
    return this.transport.request<{ requirement_id: UUID }, OperationalSignal[]>('listOperationalSignals', { requirement_id }, { signal: options?.signal });
  }

  async listFutureScenarios(project_id: UUID, options?: { signal?: AbortSignal }): Promise<FutureScenario[]> {
    return this.transport.request<{ project_id: UUID }, FutureScenario[]>('listFutureScenarios', { project_id }, { signal: options?.signal });
  }

  async createFutureScenario(
    project_id: UUID,
    request: CreateFutureScenarioRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<FutureScenario> {
    return this.transport.request<CreateFutureScenarioRequest & { project_id: UUID }, FutureScenario>('createFutureScenario', { project_id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async listEvidenceLinks(
    project_id: UUID,
    request: { entity_type?: string; entity_id?: UUID } & PaginationParams,
    options?: { signal?: AbortSignal }
  ): Promise<EvidenceLink[]> {
    return this.transport.request<{ project_id: UUID; entity_type?: string; entity_id?: UUID } & PaginationParams, EvidenceLink[]>('listEvidenceLinks', { project_id, ...request }, { signal: options?.signal });
  }

  async listTraceLinks(
    project_id: UUID,
    request: { from_type?: string; from_id?: UUID; to_type?: string; to_id?: UUID } & PaginationParams,
    options?: { signal?: AbortSignal }
  ): Promise<TraceLink[]> {
    return this.transport.request<{ project_id: UUID; from_type?: string; from_id?: UUID; to_type?: string; to_id?: UUID } & PaginationParams, TraceLink[]>('listTraceLinks', { project_id, ...request }, { signal: options?.signal });
  }

  // ===== 评审关口 =====
  async listConflicts(project_id: UUID, options?: { signal?: AbortSignal }): Promise<Conflict[]> {
    return this.transport.request<{ project_id: UUID }, Conflict[]>('listConflicts', { project_id }, { signal: options?.signal });
  }

  async getConflictDetail(id: UUID, options?: { signal?: AbortSignal }): Promise<Conflict> {
    return this.transport.request<{ id: UUID }, Conflict>('getConflictDetail', { id }, { signal: options?.signal });
  }

  async resolveConflict(
    request: { id: UUID; chosen: string; rationale: string; expected_version: number },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<Conflict> {
    return this.transport.request('resolveConflict', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async reviewOutcome(
    id: UUID,
    request: ReviewActionRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ReviewActionEntity> {
    return this.transport.request<ReviewActionRequest & { id: UUID }, ReviewActionEntity>('reviewOutcome', { id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async reviewDriver(
    id: UUID,
    request: ReviewActionRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ReviewActionEntity> {
    return this.transport.request<ReviewActionRequest & { id: UUID }, ReviewActionEntity>('reviewDriver', { id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async reviewRequirement(
    id: UUID,
    request: ReviewActionRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ReviewActionEntity> {
    return this.transport.request<ReviewActionRequest & { id: UUID }, ReviewActionEntity>('reviewRequirement', { id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async reviewConflict(
    id: UUID,
    request: ReviewActionRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ReviewActionEntity> {
    return this.transport.request<ReviewActionRequest & { id: UUID }, ReviewActionEntity>('reviewConflict', { id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async reviewGate(
    project_id: UUID,
    gate_type: GateType,
    request: ReviewActionRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<GateReviewResponse> {
    return this.transport.request<ReviewActionRequest & { project_id: UUID; gate_type: GateType }, GateReviewResponse>('reviewGate', { project_id, gate_type, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  // ===== 基线报告 =====
  async listBaselines(project_id: UUID, options?: { signal?: AbortSignal }): Promise<Baseline[]> {
    return this.transport.request<{ project_id: UUID }, Baseline[]>('listBaselines', { project_id }, { signal: options?.signal });
  }

  async createBaseline(
    request: { project_id: UUID },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<Baseline> {
    return this.transport.request('createBaseline', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async approveBaseline(
    request: { id: UUID; expected_version: number },
    options?: { signal?: AbortSignal }
  ): Promise<Baseline> {
    return this.transport.request('approveBaseline', request, { signal: options?.signal });
  }

  async compileReport(
    request: { project_id: UUID; audience: ReportSnapshot['audience']; template_version?: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('compileReport', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getReport(id: UUID, options?: { signal?: AbortSignal }): Promise<ReportSnapshot> {
    return this.transport.request<{ id: UUID }, ReportSnapshot>('getReport', { id }, { signal: options?.signal });
  }

  async listReports(project_id: UUID, request: PaginationParams, options?: { signal?: AbortSignal }): Promise<PaginatedResponse<ReportSnapshot>> {
    return this.transport.request('listReports', { project_id, ...request }, { signal: options?.signal });
  }

  async releaseReport(
    request: { id: UUID; expected_version: number },
    options?: { signal?: AbortSignal }
  ): Promise<ReportSnapshot> {
    return this.transport.request('releaseReport', request, { signal: options?.signal });
  }

  async downloadReport(
    request: { id: UUID; format: string },
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    return this.transport.request<{ id: UUID; format: string }, string>('downloadReport', request, { signal: options?.signal });
  }

  async downloadProjectReport(
    project_id: UUID,
    report_id: UUID,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    return this.transport.request<{ project_id: UUID; report_id: UUID }, string>('downloadProjectReport', { project_id, report_id }, { signal: options?.signal });
  }

  // ===== 变更管理 =====
  async createChangePreview(
    project_id: UUID,
    request: CreateChangePreviewRequest,
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ChangePreview> {
    return this.transport.request<CreateChangePreviewRequest & { project_id: UUID }, ChangePreview>('createChangePreview', { project_id, ...request }, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async getChangePreviewImpact(id: UUID, options?: { signal?: AbortSignal }): Promise<ChangePreview['impact']> {
    return this.transport.request<{ id: UUID }, ChangePreview['impact']>('getChangePreviewImpact', { id }, { signal: options?.signal });
  }

  async listChanges(project_id: UUID, options?: { signal?: AbortSignal }): Promise<Change[]> {
    return this.transport.request<{ project_id: UUID }, Change[]>('listChanges', { project_id }, { signal: options?.signal });
  }

  async createChange(
    request: { project_id: UUID; description: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<Change> {
    return this.transport.request('createChange', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getChangeImpact(id: UUID, options?: { signal?: AbortSignal }): Promise<GetChangeImpactResponse> {
    return this.transport.request<{ id: UUID }, GetChangeImpactResponse>('getChangeImpact', { id }, { signal: options?.signal });
  }

  async confirmChange(
    request: { id: UUID; expected_version: number },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<Change> {
    return this.transport.request('confirmChange', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async withdrawChange(
    request: { id: UUID; expected_version: number },
    options?: { signal?: AbortSignal }
  ): Promise<Change> {
    return this.transport.request('withdrawChange', request, { signal: options?.signal });
  }

  // ===== 表达训练 =====
  async listTrainingCases(
    request: PaginationParams & { category?: string; difficulty?: 'easy' | 'medium' | 'hard' },
    options?: { signal?: AbortSignal }
  ): Promise<PaginatedResponse<TrainingCase>> {
    return this.transport.request('listTrainingCases', request, { signal: options?.signal });
  }

  async getTrainingCaseVersion(id: UUID, version: string, options?: { signal?: AbortSignal }): Promise<TrainingCaseVersionDetail> {
    return this.transport.request<{ id: UUID; version: string }, TrainingCaseVersionDetail>('getTrainingCaseVersion', { id, version }, { signal: options?.signal });
  }

  async createTrainingAttempt(
    request: {
      case_id: UUID;
      case_version: string;
      difficulty?: 'easy' | 'medium' | 'hard' | null;
      source_kind?: TrainingAttemptSourceKind;
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<TrainingAttempt> {
    return this.transport.request('createTrainingAttempt', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getTrainingAttempt(id: UUID, options?: { signal?: AbortSignal }): Promise<TrainingAttempt> {
    return this.transport.request<{ id: UUID }, TrainingAttempt>('getTrainingAttempt', { id }, { signal: options?.signal });
  }

  async postTrainingQuestion(
    request: {
      attempt_id: UUID;
      question: string;
      bound_refs?: Array<{ id: string; title: string; detail?: string; kind?: string }>;
    },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('postTrainingQuestion', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async postTrainingSummary(
    request: { attempt_id: UUID; summary: string },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<AsyncAcceptedResponse> {
    return this.transport.request('postTrainingSummary', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async getTrainingFeedback(attempt_id: UUID, options?: { signal?: AbortSignal }): Promise<TrainingFeedback> {
    return this.transport.request<{ attempt_id: UUID }, TrainingFeedback>('getTrainingFeedback', { attempt_id }, { signal: options?.signal });
  }

  async retryTrainingAttempt(
    request: { attempt_id: UUID },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<TrainingAttempt> {
    return this.transport.request('retryTrainingAttempt', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  async completeTrainingAttempt(
    request: { attempt_id: UUID },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<TrainingAttempt> {
    return this.transport.request('completeTrainingAttempt', request, { idempotencyKey: options?.idempotencyKey ?? generateUUID(), signal: options?.signal });
  }

  // ===== 产品埋点 =====
  async postProductEvents(
    request: { events: ProductEvent[] },
    options?: { idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<ProductEventBatchResponse> {
    return this.transport.request<{ events: ProductEvent[] }, ProductEventBatchResponse>('postProductEvents', request, {
      idempotencyKey: options?.idempotencyKey ?? generateUUID(),
      signal: options?.signal,
    });
  }

  async getQuickCompletionRate(
    request: { observation_window?: string; source_kind?: 'custom' | 'sample' | 'training_fixture' | 'internal_test' },
    options?: { signal?: AbortSignal }
  ): Promise<QuickCompletionRateResponse> {
    return this.transport.request<{ observation_window?: string; source_kind?: string }, QuickCompletionRateResponse>('getQuickCompletionRate', request, { signal: options?.signal });
  }

  async listInterviewTurns(project_id: UUID, options?: { signal?: AbortSignal }): Promise<InterviewTurn[]> {
    return this.transport.request<{ project_id: UUID }, InterviewTurn[]>('listInterviewTurns', { project_id }, { signal: options?.signal });
  }
}
