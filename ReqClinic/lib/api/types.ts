// ===== 通用类型 =====
export type UUID = string;
export type ISO8601 = string;

export interface ApiError {
  error: {
    code: string;
    message: string;
    request_id: UUID;
    details?: Record<string, unknown>;
  };
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ===== Job 异步任务 =====
export type JobStatus = 'queued' | 'running' | 'validating' | 'retry_wait' | 'manual_review' | 'succeeded' | 'failed' | 'cancelled';
export type JobResultType = 'project_candidates' | 'analysis_result' | 'report_snapshot' | 'formal_map_snapshot' | 'next_question' | 'understanding_updated' | 'option_comparison' | 'brief_version' | 'training_response';

export interface AiJob {
  id: UUID;
  status: JobStatus;
  result_type: JobResultType;
  progress: number;
  current_step?: string;
  estimated_remaining_ms?: number;
  retry_after_ms?: number;
  error?: { code: string; message: string };
  result?: unknown;
  created_at: ISO8601;
  updated_at: ISO8601;
}

export interface AsyncAcceptedResponse {
  job_id: UUID;
  status: 'accepted';
}

// ===== 身份认证 =====
export interface AuthSession {
  user_id: UUID | null;
  is_authenticated: boolean;
  session_expires_at?: ISO8601;
}

// ===== 游客会话 =====
export interface GuestSession {
  id: UUID;
  session_key_hash: string;
  created_at: ISO8601;
  expires_at: ISO8601;
  claimed_by_user_id?: UUID;
}

// ===== 协议同意 =====
export interface Agreement {
  id: UUID;
  version: string;
  title: string;
  content_ref: string;
  effective_at: ISO8601;
  is_active: boolean;
}

export interface AgreementConsent {
  id: UUID;
  agreement_id: UUID;
  agreement_version: string;
  scope: 'quick' | 'formal' | 'training';
  consented_at: ISO8601;
  withdrawn_at?: ISO8601;
  idempotency_key: UUID;
}

// ===== 快速问诊 =====
export type QuickSessionStatus = 'draft' | 'clarifying' | 'understanding_review' | 'option_review' | 'brief_ready' | 'upgraded' | 'archived';
export type QuickSessionSourceKind = 'sample' | 'custom';
export type CoverageSlotName = 'expected_outcome' | 'target_user' | 'core_scenario' | 'scope_boundary' | 'completion_criteria' | 'constraints_risks';
export type CoverageSlotState = 'covered' | 'partial' | 'not_started';
export type BriefViewType = 'simple' | 'exec';
export type TopicChangeAction = 'append' | 'new_session' | 'defer';

export interface QuickSession {
  id: UUID;
  version: number;
  status: QuickSessionStatus;
  source_kind: QuickSessionSourceKind;
  source_case_id?: string;
  original_input: string;
  quick_options?: QuickOption[];
  recommendation?: string | null;
  current_understanding_version: number;
  brief_version: number;
  active_job_id?: UUID;
  created_at: ISO8601;
  updated_at: ISO8601;
  estimated_purge_at?: ISO8601;
}

export interface QuickOption {
  id: UUID;
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  is_recommended: boolean;
}

export interface QuickSessionTurn {
  id: UUID;
  session_id: UUID;
  role: 'user' | 'assistant';
  content: string;
  structured_content?: {
    paragraphs?: string[];
    bullets?: string[];
    highlights?: string[];
  };
  source_refs?: string[];
  update_marks?: string[];
  follow_ups?: string[];
  referenced_card_ids?: UUID[];
  created_at: ISO8601;
}

export interface CoverageSlot {
  name: CoverageSlotName;
  label: string;
  state: CoverageSlotState;
  is_blocking: boolean;
}

export interface QuickSessionUnderstanding {
  session_id: UUID;
  version: number;
  summary: string;
  slots: {
    expected_outcome?: string;
    target_user?: string;
    core_scenario?: string;
    scope_boundary?: string;
    completion_criteria?: string;
    constraints_risks?: string;
  };
  coverage_slots: CoverageSlot[];
}

export interface QuickSessionUnknown {
  id: UUID;
  session_id: UUID;
  question: string;
  is_blocking: boolean;
  impact: string;
  suggested_owner?: string;
}

export interface BriefOption {
  id: UUID;
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  effort: 'low' | 'medium' | 'high';
  reversible: boolean;
  is_recommended: boolean;
}

export interface BriefVersion {
  version: number;
  session_id: UUID;
  generated_at: ISO8601;
  is_incomplete: boolean;
  blocking_unknowns_count: number;
  non_blocking_unknowns_count: number;
}

export interface BriefView {
  view_type: BriefViewType;
  brief_version: number;
  content: string;
  sections?: { title: string; content: string }[];
}

export interface BriefExport {
  export_id: UUID;
  expires_at: ISO8601;
  formats: string[];
}

export interface BriefUsefulnessFeedback {
  rating: 'directly_usable' | 'needs_major_changes' | 'unusable';
  expected_use: string;
}

// ===== 正式项目 =====
export type ProjectStatus = 'draft' | 'ingesting' | 'eliciting' | 'reviewing' | 'baselined' | 'reporting' | 'released' | 'changing' | 'archived';
export type ProjectSourceKind = 'custom' | 'sample' | 'quick_upgrade';

export interface Project {
  id: UUID;
  title: string;
  status: ProjectStatus;
  description?: string | null;
  source_kind?: ProjectSourceKind;
  source_case_id?: string | null;
  version: number;
  created_by: UUID;
  created_at: ISO8601;
  updated_at: ISO8601;
  estimated_purge_at?: ISO8601;
}

export interface ProjectMember {
  id: UUID;
  project_id: UUID;
  user_id: UUID;
  display_name: string;
  role: 'owner' | 'analyst' | 'reviewer' | 'observer';
  initials: string;
}

export interface Stakeholder {
  id: UUID;
  project_id: UUID;
  name: string;
  type: 'organization' | 'person';
  power: 'high' | 'medium' | 'low';
  interest: 'high' | 'medium' | 'low';
  stance?: string;
}

export interface InterviewTurn {
  id: UUID;
  project_id: UUID;
  stakeholder_id?: UUID;
  role: 'interviewer' | 'interviewee';
  content: string;
  created_at: ISO8601;
}

export interface EvidenceSpan {
  id: UUID;
  source_id: UUID;
  text: string;
  location: { start: number; end: number };
  speaker?: string;
  timestamp?: ISO8601;
}

export interface Source {
  id: UUID;
  project_id: UUID;
  filename: string;
  mime_type: string;
  byte_size: number;
  sensitivity: 'public' | 'internal' | 'confidential';
  extraction_status: 'pending' | 'processing' | 'completed' | 'failed';
  uploaded_at: ISO8601;
}

export type FormalMapModuleStatus = '已整理' | '正在梳理' | '建议确认' | '待补充' | '有方案可选';

export interface FormalMapOption {
  id: string;
  title: string;
  fit: string;
  tradeoff: string;
  recommended?: boolean;
}

export interface FormalMapModule {
  id: string;
  title: string;
  status: FormalMapModuleStatus;
  summary: string;
  known: string[];
  assumptions: string[];
  questions: string[];
  options?: FormalMapOption[];
  relatedModuleIds?: string[];
}

export interface FormalGuidanceState {
  status: 'eliciting' | 'review_ready';
  coveredModuleCount: number;
  totalModuleCount: number;
  unresolvedCount: number;
  reportReady: boolean;
  completionReason: string | null;
}

export interface FormalMapData {
  result_type: 'formal_map_snapshot';
  title: string;
  summary: string;
  projectType: string;
  sourceContext: string;
  currentModuleId: string;
  nextQuestion: string | null;
  guidanceState: FormalGuidanceState;
  generationSteps: { label: string; state: 'done' | 'active' | 'pending' }[];
  modules: FormalMapModule[];
  unresolvedItems: { id: string; label: string; detail: string; impact: string }[];
  reportProjection: { overview: string; detailedReport: string };
  qualityNotes: string[];
}

export interface FormalMapSnapshot {
  id: UUID;
  project_id: UUID;
  version: number;
  status: 'draft' | 'ready' | 'fallback';
  source_kind: 'direct' | 'quick_upgrade' | 'conversation_update' | 'fallback';
  created_at: ISO8601;
  data: FormalMapData;
}

export interface FormalMapMessage {
  id: UUID;
  project_id: UUID;
  role: 'assistant' | 'user';
  content: string;
  message_type: 'question' | 'answer' | 'status';
  bound_refs: Array<{ id: string; title: string; detail?: string; kind?: string }>;
  created_at: ISO8601;
}

export interface FormalMapResponse {
  project_id: UUID;
  active_job_id?: UUID | null;
  snapshot: FormalMapSnapshot | null;
  messages: FormalMapMessage[];
}

// ===== 需求工程实体 =====
export type RequirementTier = 'now' | 'next' | 'later' | 'watch' | 'wont_do';

export interface Outcome {
  id: UUID;
  project_id: UUID;
  code: string;
  title: string;
  description: string;
  status: 'draft' | 'proposed' | 'confirmed' | 'modified' | 'rejected' | 'uncertain';
  version: number;
  owner_id?: UUID;
  evidence_refs: UUID[];
}

export interface Driver {
  id: UUID;
  project_id: UUID;
  code: string;
  title: string;
  description: string;
  status: 'draft' | 'proposed' | 'confirmed' | 'modified' | 'rejected' | 'uncertain';
  version: number;
}

export interface Requirement {
  id: UUID;
  project_id: UUID;
  code: string;
  title: string;
  description: string;
  tier: RequirementTier;
  status: 'draft' | 'proposed' | 'confirmed' | 'modified' | 'rejected' | 'uncertain';
  version: number;
  outcome_id?: UUID;
}

export interface AcceptanceCriterion {
  id: UUID;
  requirement_id: UUID;
  given: string;
  when: string;
  then: string;
}

export interface Conflict {
  id: UUID;
  project_id: UUID;
  statement: string;
  severity: 'blocking' | 'major' | 'minor';
  status: 'open' | 'resolved' | 'deferred';
  version: number;
  parties: { viewpoint: string; evidence_refs: UUID[] }[];
  candidates?: BriefOption[];
  decision?: { chosen: string; rationale: string; decided_at: ISO8601 };
}

export interface Gate {
  id: UUID;
  project_id: UUID;
  stage: 'outcome' | 'evidence_conflict' | 'scope';
  status: 'pending' | 'passed' | 'failed' | 'waived';
  reviewed_at?: ISO8601;
  reviewer_id?: UUID;
  reason?: string;
}

// ===== 基线与报告 =====
export interface Baseline {
  id: UUID;
  project_id: UUID;
  version: number;
  created_at: ISO8601;
  approved_at?: ISO8601;
  approved_by?: UUID;
  status: 'draft' | 'approved' | 'superseded';
}

export type ReportGateCode = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
export type ReportGateStatus = 'pass' | 'fail' | 'warn';

export interface ReportGateDefect {
  gate: ReportGateCode;
  status: ReportGateStatus;
  message: string;
  entity_refs?: string[];
}

export interface ReportSnapshot {
  id: UUID;
  project_id: UUID;
  report_number: string;
  version: number;
  audience: 'management' | 'product_business' | 'architecture' | 'dev_qa' | 'compliance_ops';
  status: 'compiling' | 'ready' | 'released' | 'rejected';
  data_fingerprint: string;
  template_version: string;
  domain_profile_version?: string;
  chapters: { index: number; title: string; content: string }[];
  gate_defects: ReportGateDefect[];
  chapter_coverage: number;
  compiled_at?: ISO8601;
  released_at?: ISO8601;
}

// ===== 变化管理 =====
export interface ChangePreview {
  id: UUID;
  project_id: UUID;
  description: string;
  trigger_reason: string;
  impact: ChangeImpactItem[];
  created_at: ISO8601;
}

export interface ChangeImpactItem {
  entity_type: 'outcome' | 'driver' | 'requirement' | 'evidence' | 'decision' | 'acceptance' | 'report';
  entity_id: UUID;
  impact_type: 'modified' | 'added' | 'removed' | 'invalidated';
  severity: 'blocking' | 'major' | 'minor';
  recommended_action: string;
}

export interface Change {
  id: UUID;
  project_id: UUID;
  description: string;
  status: 'pending' | 'confirmed' | 'withdrawn';
  impact: ChangeImpactItem[];
  created_at: ISO8601;
  confirmed_at?: ISO8601;
}

// ===== 表达训练 =====
export type TrainingAttemptStatus = 'not_started' | 'interviewing' | 'summarizing' | 'feedback_ready' | 'completed' | 'retrying';
export type TrainingAttemptSourceKind = 'custom' | 'sample';

export interface TrainingCase {
  id: UUID;
  title: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  version: string;
  description: string;
}

export interface TrainingAttemptMessage {
  id: UUID;
  role: 'user' | 'assistant';
  speaker?: 'user' | 'role' | 'coach';
  content: string;
  bindings?: Array<{ id?: string; title?: string; detail?: string }>;
  coach_projection?: {
    next_hint?: string;
    question_quality_note?: string;
    visible_progress_label?: string;
  };
  created_at: ISO8601;
}

export interface TrainingAttempt {
  attempt_id: UUID;
  case_id: UUID;
  case_version: string;
  source_kind?: TrainingAttemptSourceKind;
  status: TrainingAttemptStatus;
  question_count: number;
  started_at: ISO8601;
  completed_at?: ISO8601 | null;
  messages?: TrainingAttemptMessage[];
  coach_projection?: {
    next_hint?: string;
    question_quality_note?: string;
    visible_progress_label?: string;
  } | null;
}

export interface TrainingFeedbackDimensionBreakdown {
  dimension: string;
  status: 'covered' | 'partial' | 'missing';
  evidence: string;
  comment: string;
}

export interface TrainingFeedbackImprovementExample {
  before: string;
  after: string;
  reason: string;
}

export interface TrainingFeedback {
  coverage_score: number;
  missing_dimensions: string[];
  improvement_suggestions: string[];
  dimension_breakdown: TrainingFeedbackDimensionBreakdown[];
  improvement_examples: TrainingFeedbackImprovementExample[];
}

// ===== 领域画像 =====
export interface DomainProfile {
  id: UUID;
  project_id: UUID;
  status: 'draft' | 'reviewed' | 'accepted' | 'modified' | 'rejected' | 'uncertain';
  suggested_packs: string[];
  review_result?: { action: 'accept' | 'modify' | 'reject' | 'uncertain'; reason?: string };
}

export interface DomainPack {
  id: UUID;
  code: string;
  name: string;
  version: string;
  is_static: boolean;
}

// ===== 删除任务 =====
export interface DeleteTask {
  id: UUID;
  entity_type: 'project' | 'quick_session';
  entity_id: UUID;
  status: 'pending' | 'processing' | 'completed' | 'blocked';
  estimated_purge_at: ISO8601;
  blocked_reason?: 'legal_hold';
}

// ===== 评审动作 =====
export type ReviewAction = 'accept' | 'modify' | 'reject' | 'uncertain';
export type ReviewableEntityType = 'outcome' | 'driver' | 'requirement' | 'conflict' | 'gate' | 'domain_profile' | 'understanding';

export interface ReviewRequest {
  entity_type: ReviewableEntityType;
  entity_id: UUID;
  expected_version: number;
  action: ReviewAction;
  reason?: string;
  after_value?: Record<string, unknown>;
  follow_up?: string;
}

// ===== 产品埋点 =====
export interface ProductEvent {
  event_name: string;
  event_timestamp: ISO8601;
  session_id?: UUID;
  properties: Record<string, unknown>;
}

// ===== OpenAPI v1.2.0 契约对齐新增类型 =====

// 关口类型
export type GateType = 'outcome' | 'evidence_conflict' | 'scope';

// 评审动作请求（OpenAPI ReviewActionRequest）
export interface ReviewActionFollowUp {
  owner_id: string;
  required_evidence: string;
  review_condition: string;
}

export interface ReviewActionRequest {
  action: ReviewAction;
  entity_version: number;
  reason: string;
  after_value?: Record<string, unknown>;
  follow_up?: ReviewActionFollowUp;
}

// 评审动作响应实体（OpenAPI ReviewActionEntity）
export interface ReviewActionEntity {
  id: UUID;
  project_id?: UUID | null;
  gate?: string | null;
  entity_type: string;
  entity_id: UUID;
  entity_version: number;
  action: ReviewAction;
  reviewer_id: string;
  reason: string;
  after_value?: Record<string, unknown> | null;
  follow_up?: ReviewActionFollowUp | null;
  created_at: ISO8601;
}

// 关口评审响应（OpenAPI GateReviewResponse.data）
export interface GateReviewResponse extends ReviewActionEntity {
  gate: string;
}

// 变化预演请求（OpenAPI CreateChangePreviewRequest）
export interface ChangePreviewScenario {
  type: string;
  description: string;
  affected_entities?: Record<string, unknown>[];
  proposed_changes?: Record<string, unknown>;
}

export interface CreateChangePreviewRequest {
  baseline_id: UUID;
  scenario: ChangePreviewScenario;
}

// 变化影响（OpenAPI GetChangeImpactResponse.data）
export interface ChangeImpact {
  id: UUID;
  entity_type: string;
  entity_id: UUID;
  impact_type: string;
  severity: 'blocking' | 'major' | 'minor' | 'critical';
  recommended_action: string;
  required_stage?: string;
  rationale?: string;
  status?: string;
}

export interface GetChangeImpactResponse {
  change_id: UUID;
  status: string;
  impacts: ChangeImpact[];
  suggested_stages: string[];
  created_at: ISO8601;
}

// 验证工件（OpenAPI VerificationArtifact）
export interface VerificationArtifact {
  id: UUID;
  project_id: UUID;
  requirement_id: UUID;
  acceptance_criterion_id: UUID;
  artifact_type: string;
  description: string;
  source_id: UUID;
  result: string;
  executed_at: ISO8601;
  status: string;
  created_at: ISO8601;
}

export interface CreateVerificationArtifactRequest {
  acceptance_criterion_id?: UUID;
  artifact_type: string;
  description: string;
  source_id?: UUID;
  result: string;
  executed_at?: ISO8601;
}

// 持续观测信号（OpenAPI OperationalSignal）
export interface OperationalSignal {
  id: UUID;
  project_id: UUID;
  requirement_id: UUID;
  name: string;
  measurement: string;
  threshold_value: string;
  unit: string;
  observation_window: string;
  owner_id: UUID;
  review_cadence: string;
  trigger_condition: string;
  status: string;
  version: number;
  created_at: ISO8601;
  updated_at: ISO8601;
}

// 未来场景（OpenAPI FutureScenario）
export interface FutureScenario {
  id: UUID;
  project_id: UUID;
  name: string;
  description: string;
  probability_class: string;
  activation_trigger: string;
  leading_indicators: Record<string, unknown>[];
  horizon: string;
  architecture_response?: string | null;
  status: string;
  version: number;
  created_at: ISO8601;
  updated_at: ISO8601;
}

export interface CreateFutureScenarioRequest {
  name: string;
  description: string;
  probability_class?: string;
  activation_trigger?: string;
  leading_indicators?: Record<string, unknown>[];
  horizon: string;
}

// 证据链接（OpenAPI EvidenceLink）
export interface EvidenceLink {
  id: UUID;
  project_id: UUID;
  entity_type: string;
  entity_id: UUID;
  evidence_span_id: UUID;
  relation: 'supports' | 'contradicts' | 'qualifies' | 'originates';
  created_by: UUID;
  created_at: ISO8601;
}

// 追踪链接（OpenAPI TraceLink）
export interface TraceLink {
  id: UUID;
  project_id: UUID;
  from_type: string;
  from_id: UUID;
  relation: string;
  to_type: string;
  to_id: UUID;
  status: 'active' | 'superseded' | 'invalidated';
  created_at: ISO8601;
}

// 领域包版本详情（OpenAPI DomainPackVersionDetail）
export interface DomainPackVersionDetail {
  id: string;
  version: string;
  name: string;
  status: string;
  compatible_core_schema: string;
  manifest: Record<string, unknown>;
  manifest_hash: string;
  released_at: ISO8601;
  deprecated_at?: ISO8601 | null;
}

// 领域包摘要（OpenAPI DomainPackSummary）
export interface DomainPackSummary {
  id: string;
  name: string;
  latest_version: string;
  status: string;
  compatible_core_schema: string;
  released_at: ISO8601;
}

// 领域包激活请求/响应（OpenAPI ActivateDomainPackRequest/Response）
export interface ActivateDomainPackRequest {
  domain_pack_version: string;
  domain_profile_id: string;
  activation_reason: string;
}

export interface ActivateDomainPackResponse {
  id: UUID;
  project_id: UUID;
  domain_pack_id: string;
  domain_pack_version: string;
  domain_profile_id: string;
  activation_reason: string;
  status: string;
  activated_by: UUID;
  activated_at: ISO8601;
}

// 训练案例版本详情（OpenAPI TrainingCaseVersionDetail）
export interface TrainingCaseVersionDetail {
  case_id: UUID;
  case_version: string;
  title: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  role_label: string;
  practice_goal: string;
  visible_constraints: string[];
  evaluation_dimensions_public: string[];
  status: 'active' | 'deprecated';
}

// 产品埋点批量响应（OpenAPI ProductEventBatchResponse）
export interface ProductEventBatchResponse {
  accepted_count: number;
  rejected_count: number;
  duplicates_count: number;
}

// 快速问诊完成率响应（OpenAPI QuickCompletionRateResponse）
export interface QuickCompletionRateResponse {
  metric_name: 'quick-completion-rate';
  numerator: number;
  denominator: number;
  observation_window: string;
  sample_size: number;
  filters?: Record<string, unknown>;
  calculated_at?: ISO8601;
}
