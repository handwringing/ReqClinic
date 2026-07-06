# 表达训练真实链路开发计划书

> 文档状态：Implementation Baseline v0.3  
> 更新日期：2026-07-06  
> 适用范围：表达训练从当前演示体验升级为真实 DeepSeek 链路、可审计后端 Runtime、可浏览器验收的产品功能。  
> 相关文档：`03-api-design.md` §12A、`04-database-design.md` §12A、`05-fsd.md` §5、`06-interaction-flow.md` §7、`07-agent-skill-backend.md` §10。

## 1. 目标结论

表达训练不应复用快速问诊或正式项目的产品逻辑。它是第三种独立模式：

1. 快速问诊：AI 主动追问，帮用户把真实需求说清楚。
2. 正式项目：AI 引导建档和需求地图，产出更专业的项目指导报告。
3. 表达训练：用户练习如何追问，AI 扮演客户、老师、同事或业务方，教练系统给反馈。

表达训练的核心目标不是产出真实项目需求，而是训练用户的需求沟通能力。它要回答三个问题：

1. 用户会不会问到关键问题。
2. 用户能不能把对方回答整理成清楚的需求描述。
3. 系统能不能指出遗漏、给出更好的追问示例，并让用户重复练习。

首期开发目标是：保留现有 `training` API 外壳，补齐真实后端 Agent + Skill Runtime，让表达训练能通过胜算云 `deepseek/deepseek-v4-flash` 完成“选择案例 → 用户追问 → AI 角色回答 → 用户总结 → AI 教练反馈 → 重新练习/完成”的闭环。

## 2. 当前状态与主要缺口

### 2.1 已有基础

当前代码和文档已经具备以下基础，并已进入真实链路浏览器验收阶段：

1. 文档层已经把表达训练定义为独立模式，不写入快速问诊或正式项目。
2. 后端已有 `training_cases`、`training_attempts`、`training_questions`、`training_summaries`、`training_feedback` 和 `training_turns` 六类训练表。
3. 后端已有 9 个训练接口 operationId：
   - `listTrainingCases`
   - `getTrainingCaseVersion`
   - `createTrainingAttempt`
   - `postTrainingQuestion`
   - `postTrainingSummary`
   - `getTrainingAttempt`
   - `getTrainingFeedback`
   - `retryTrainingAttempt`
   - `completeTrainingAttempt`
4. 前端已有 `/training/cases` 和 `/training/[attemptId]` 页面。
5. 前端已有左侧角色对话、右侧练习助手、案例 token、总结草稿和反馈页。
6. 后端已有 `TrainingJobExecutor`、`TrainingPracticeRuntime`、`training_practice.v1` AgentPlan、Schema Gate、DeepSeek 调用、AgentRun/SkillRun/AiRun 审计和确定性 fallback。
7. `postTrainingQuestion` 与 `postTrainingSummary` 均返回 `202 + job_id`，并通过 JobWorker 进入训练 Runtime。

### 2.2 当前验收重点

当前表达训练的主要任务不再是从零开发，而是围绕浏览器体验和质量闭环继续收口。本轮浏览器验收已经跑通固定情境、角色回答、无意义追问、总结和反馈闭环；移动端入口已调整为先展示固定情境，再展示自定义输入说明。

1. 前端必须以后端 `messages` 和 `coach_projection` 为准恢复对话，刷新、返回重进不能丢失已追问内容。
2. `training_turns` 只服务表达训练恢复和反馈上下文，不写入快速问诊、正式项目或项目事实资产。
3. 反馈页要稳定渲染 Runtime 的 `dimensions / missed_high_value_questions / improvement_examples / summary_review`，不能把所有维度都误显示成“部分覆盖”。
4. 浏览器不得拿到 `answer_key`、完整 `disclosure_rules`、隐藏事实或评分触发规则。
5. 用户可见文案必须自然，不出现 `attempt`、`rubric`、`disclosure_rule`、`training_response`、`agent`、`skill` 等内部词。
6. 浏览器验收要覆盖首页进入、案例选择、追问、无意义追问、刷新恢复、提交总结、反馈、再练一次、完成练习和移动端。
7. 每次真实 DeepSeek 验收需记录训练相关 `ai_runs / skill_runs` 的 provider、model、thinking、input/output token 和是否估算。

## 3. 产品边界

### 3.1 表达训练要做什么

表达训练首期只做四件事：

1. 给用户一个具体案例和角色场景。
2. 引导用户一轮一轮提出澄清问题。
3. 由 AI 按案例隐藏信息和披露规则扮演对方回答。
4. 在用户提交总结后，给出覆盖情况、遗漏点、改进追问和更好的总结示例。

### 3.2 表达训练不做什么

表达训练首期明确不做：

1. 不把训练结果写入快速问诊或正式项目。
2. 不把 AI 角色回答当作真实需求事实。
3. 不生成正式需求报告。
4. 不展示正式项目地图。
5. 不在访谈过程中泄露评分维度命中、隐藏答案或缺失项。
6. 不宣称分数是能力认证，只说“本轮练习反馈”。

## 4. 用户逐屏流程

### 4.1 首页入口

首页仍保持三个同级入口：

1. 快速问诊
2. 正式项目
3. 表达训练

点击“表达训练”进入 `/training/cases`。顶部导航顺序与其他页面统一：

```text
返回 / Requirements Clinic
```

其中“返回”始终返回上一个页面，点击 `Requirements Clinic` 回首页。

### 4.2 训练案例页

页面目标：让用户快速理解“这是练习追问能力，不是真实项目分析”。

首屏结构：

```text
标题：选择一个练习场景
说明：你来追问，AI 扮演对方；结束后会给出本轮反馈。

案例卡片：
- 外包采购：把官网重做说成可验收的交付范围
- 服务流程：追问健身房续费流程的关键卡点
- 学术任务：把宽泛论文题目收窄成研究问题
- 协作项目：梳理多人毕业设计的分工与验收标准
- 创意简报：追问投放海报的目标、渠道和表达边界
- 早期想法：把模糊产品想法拆成可验证假设
```

交互要求：

1. 点击案例直接创建练习并进入 `/training/[attemptId]`。
2. 不让用户先填写大段信息。
3. 当前版本如果不支持自定义练习，自定义输入必须弱化为次要记录区，并在移动端放到固定情境之后；点击时只显示自然提示，不创建训练回合。
4. 案例卡片副标题只描述练习对象，不出现“demo 预设流程”等内部说法。
5. 训练案例之间要正交：同一模式内案例尽量覆盖不同表达能力，不只是换主题。

### 4.3 训练对话页

页面布局延续当前左右分屏：

```text
左侧：练习对话
- AI 扮演角色
- 用户提出追问
- 输入框
- 当前建议追问

右侧：练习助手
- 场景简介
- 当前练习目标
- 可引用的案例信息
- 总结草稿
- 提交并查看反馈
```

交互主线：

1. 进入页面后，AI 先用角色口吻给出场景背景。
2. 教练区域给出“建议你先问什么”，但不直接替用户完成。
3. 用户可以点击“填入追问”，也可以自己编辑。
4. 点击“发送”后，后端创建训练追问 job。
5. 前端展示等待态：“对方正在回答，通常只需要几秒。”
6. job 成功后，左侧出现 AI 角色回答。
7. 右侧只更新安全的练习状态，例如已追问次数、下一步建议；不显示隐藏答案、分数、遗漏维度。
8. 用户完成若干轮后，在右侧写总结草稿。
9. 点击“提交并查看反馈”，后端生成反馈，页面进入反馈页。

### 4.4 训练反馈页

反馈页目标：让用户知道哪里问得好、哪里漏了、下次怎么问。

推荐结构：

```text
本轮反馈
- 总体表现：普通语言说明，不只显示分数
- 覆盖情况：按维度展示
- 漏掉的关键问题：说明为什么重要
- 更好的追问示例：before / after / reason
- 总结质量：是否准确、是否混入猜测、是否遗漏边界
- 改进后的总结示例：给用户学习参考

底部操作：
- 同类再练一次
- 换一个案例
- 完成练习
```

文案要求：

1. “覆盖度”“遗漏点”可以出现，但要配合普通解释。
2. 不使用 `attempt`、`rubric`、`disclosure_rule`、`training_response` 等内部词。
3. “通过线”不应太像考试认证，建议改成“本轮建议目标”或“建议达成水平”。
4. 分数可以保留，但必须说明“只代表本轮练习反馈”。

### 4.5 持续学习闭环

当前版本在单次练习闭环之外，增加轻量持续学习能力：

1. “同类再练一次”创建同一情境的新 attempt，保留原情境主题，让用户在相近上下文里改进追问方式。
2. 反馈页展示用户能理解的维度趋势：目标、对象、场景、边界、验收。
3. 趋势数据只保存在当前浏览器本地，用于同类复练对比；不写入快速问诊、正式项目、地图快照或真实需求资产。
4. 趋势只展示覆盖变化，不展示隐藏事实、答案 key、披露规则或评分触发阈值。
5. 如果用户换案例，趋势不跨案例比较，避免把不同训练目标混成同一能力分数。

## 5. 后端架构方案

### 5.1 总体架构

表达训练使用与快速问诊、正式项目一致的后端形态：

```text
Frontend
  -> Training REST API
    -> ai_jobs(scope_kind='training_attempt')
      -> JobWorker
        -> TrainingJobExecutor
          -> TrainingPracticeRuntime
            -> Training Skill Runtime
              -> OpenAiCompatibleProvider
                -> 胜算云 DeepSeek V4 Flash
```

外部不新增 Agent API。前端仍调用训练 REST 接口，异步任务仍返回 `202 + job_id`，前端仍轮询 `/api/v1/ai-jobs/:id`。

### 5.2 新增 TrainingJobExecutor

新增 `backend/src/queue/training-job-executor.ts`。

职责：

1. 接管 `scope_kind='training_attempt'` 的 job。
2. 根据 `task_type` 调用训练 runtime。
3. 持久化训练问题命中结果、角色回答、反馈结果。
4. 返回符合 `AiInvokeResult` 的结果，包含：
   - `provider`
   - `model`
   - `promptVersion`
   - `inputTokens`
   - `outputTokens`
   - `thinkingMode`
   - `usageEstimated`
   - `skillAudits`

`JobWorker` 调度逻辑调整为：

```ts
updated.scopeKind === 'quick_session'
  ? quickJobExecutor.process(updated, payload)
  : updated.scopeKind === 'formal_project' && updated.taskType === 'formal_guidance'
    ? formalJobExecutor.process(updated, payload)
    : updated.scopeKind === 'training_attempt'
      ? trainingJobExecutor.process(updated, payload)
      : invocation.invokeProvider()
```

### 5.3 新增 TrainingPracticeRuntime

新增 `backend/src/agent/training-runtime.ts`。

Runtime 输入：

```ts
interface TrainingRuntimeInput {
  attemptId: string;
  caseSnapshot: TrainingCasePrivateSnapshot;
  visibleCaseBrief: TrainingCasePublicBrief;
  priorTurns: TrainingTurn[];
  currentQuestion?: string;
  submittedSummary?: string;
  taskType: 'training_response' | 'training_feedback';
  modelEnabled: boolean;
}
```

Runtime 输出分两类：

```ts
interface TrainingResponseOutput {
  result_type: 'training_response';
  role_answer: {
    content: string;
    tone: 'customer' | 'teacher' | 'colleague' | 'business_owner';
    disclosed_rule_ids: string[];
    safe_to_show: true;
  };
  coach_projection: {
    next_hint: string;
    question_quality_note: string;
    visible_progress_label: string;
  };
}
```

```ts
interface TrainingFeedbackOutput {
  result_type: 'training_feedback';
  score: {
    total: number;
    max: number;
    label: string;
  };
  dimensions: TrainingFeedbackDimension[];
  missed_high_value_questions: string[];
  improvement_examples: Array<{
    before: string;
    after: string;
    reason: string;
  }>;
  summary_review: {
    accuracy: string;
    missing_points: string[];
    unsupported_claims: string[];
    improved_summary: string;
  };
}
```

## 6. AgentPlan 与 Skill 设计

### 6.1 AgentPlan

新增真实训练 AgentPlan：

```ts
export const TRAINING_PRACTICE_PLAN: AgentPlan = {
  planId: 'training_practice',
  planVersion: '1.0.0',
  agentId: ORCHESTRATOR_AGENT_ID,
  mode: 'training',
  taskTypes: ['training_response', 'training_feedback'],
  steps: [
    { skillId: 'training.routing.case_context', skillVersion: '1.0.0' },
    { skillId: 'training.roleplay.answer', skillVersion: '1.0.0' },
    { skillId: 'training.structuring.coverage_update', skillVersion: '1.0.0' },
    { skillId: 'training.validation.question_quality', skillVersion: '1.0.0' },
    { skillId: 'training.coaching.next_hint', skillVersion: '1.0.0' },
    { skillId: 'training.composition.feedback_report', skillVersion: '1.0.0' },
  ],
};
```

### 6.2 Skill 分工

| Skill | 调用模型 | 作用 | 输出是否给用户看 |
|---|---:|---|---|
| `training.routing.case_context` | 否 | 读取案例、难度、角色、目标维度 | 否 |
| `training.roleplay.answer` | 是 | 扮演客户/老师/同事/业务方回答用户追问 | 是 |
| `training.structuring.coverage_update` | 可选 | 判断用户追问命中的维度和披露规则 | 否 |
| `training.validation.question_quality` | 可选 | 判断问题是否有效、是否太空泛、是否重复 | 部分展示 |
| `training.coaching.next_hint` | 是或确定性 | 给下一步练习提示，不泄露答案 | 是 |
| `training.composition.feedback_report` | 是 | 用户总结后生成完整反馈 | 是 |

### 6.3 Skill Manifest 要求

每个训练 Skill Manifest 必须声明：

```ts
interface TrainingSkillManifest {
  skill_id: string;
  skill_version: string;
  category: 'routing' | 'elicitation' | 'structuring' | 'validation' | 'decisioning' | 'composition';
  supported_modes: ['training'];
  input_schema_version: string;
  output_schema_version: string;
  prompt_version: string;
  allowed_state_transitions: string[];
  allowed_writes: string[];
  required_domain_packs: string[];
  validators: string[];
}
```

训练 Skill 的写权限必须非常窄：

1. 可以写 `training_questions.disclosure_rule_hit`。
2. 可以写训练角色回答快照表。
3. 可以写 `training_feedback`。
4. 不得写 `quick_sessions`。
5. 不得写 `projects`、`requirements`、`baselines`、`formal_map_snapshots`。

## 7. 案例与隐藏信息设计

### 7.1 案例数据拆分

训练案例必须分为公开部分和私有部分。

公开给前端：

```ts
interface TrainingCasePublicBrief {
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
```

只留在后端：

```ts
interface TrainingCasePrivateManifest {
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
```

### 7.2 需要立即修正的接口风险

`getTrainingCaseVersion` 不应把 `answer_key` 或完整 `disclosure_rules` 返回给前端。当前 API Markdown 和 OpenAPI 已按公开详情修订，后续实现需要对齐：

1. 保留原 operationId，但响应改为公开详情。
2. 后端内部通过 repo 读取完整 manifest。
3. 后端路由和前端类型同步改为公开详情，避免继续使用旧 `manifest.answer_key` 形态。
4. 如果暂时兼容旧前端，至少让旧字段为空，并确保 `disclosure_rules` 只返回公开说明，不返回触发规则。

## 8. API 调用设计

### 8.1 前端调用 ReqClinic 后端

前端不得直接调用胜算云或 DeepSeek。所有模型调用只能发生在后端。

训练案例页：

```ts
const api = getApiClient();

const cases = await api.listTrainingCases({
  limit: 50,
});
```

开始练习：

```ts
const attempt = await api.createTrainingAttempt({
  case_id: selectedCase.id,
  case_version: selectedCase.latest_version,
  difficulty: selectedDifficulty,
});

router.push(`/training/${attempt.attempt_id}`);
```

提交追问：

```ts
const accepted = await api.postTrainingQuestion({
  attempt_id: attempt.attempt_id,
  question: input.trim(),
});

await pollJob(accepted.job_id);
const updatedAttempt = await api.getTrainingAttempt(attempt.attempt_id);
```

提交总结：

```ts
const accepted = await api.postTrainingSummary({
  attempt_id: attempt.attempt_id,
  summary: summaryDraft.trim(),
});

await pollJobIfReturned(accepted.job_id);

let attempt = await api.getTrainingAttempt(attemptId);
while (attempt.status !== 'feedback_ready') {
  await sleep(1500);
  attempt = await api.getTrainingAttempt(attemptId);
}

const feedback = await api.getTrainingFeedback(attemptId);
```

### 8.2 是否调整 `postTrainingSummary`

当前文档写的是 `POST /training-attempts/:id/summary` 返回 `200 + status=summarizing`，然后前端轮询 attempt。为了和快速问诊、正式项目一致，建议升级为：

1. `postTrainingSummary` 返回 `202 + job_id`。
2. 前端先轮询 job，再读 `getTrainingAttempt` 和 `getTrainingFeedback`。
3. 如果短期不改公开契约，也必须在后端提交 summary 时真实入队，并让 `getTrainingAttempt` 能从 `summarizing` 变为 `feedback_ready`。

首选方案：同步更新 API 文档和 OpenAPI，把 `postTrainingSummary` 改为异步写命令。理由是总结反馈会调用模型，耗时和失败语义都应进入 AI Job 审计链。

### 8.3 后端调用胜算云 DeepSeek

当前后端已经有 OpenAI-compatible provider，调用方式是：

```text
POST {OPENAI_COMPAT_BASE_URL}/chat/completions
Authorization: Bearer {OPENAI_COMPAT_API_KEY}
Content-Type: application/json
```

请求体由 `OpenAiCompatibleProvider` 统一构造：

```json
{
  "model": "deepseek/deepseek-v4-flash",
  "stream": false,
  "temperature": 0.2,
  "max_tokens": 4096,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

如果启用 thinking：

```json
{
  "thinking": { "type": "enabled" }
}
```

当前默认可以保持 `OPENAI_COMPAT_THINKING=unset`。表达训练更重视稳定角色扮演和简洁反馈，不建议首期强制开启 thinking。若要只对总结反馈开启，可以设置：

```powershell
$env:OPENAI_COMPAT_THINKING_TASKS="training_feedback"
```

### 8.4 本地启动方式

API key 不写入仓库、不写入前端、不打印日志。本地可按 `backend/.env.example` 在当前 PowerShell 会话中设置环境变量：

```powershell
$env:AI_PROVIDER="openai_compatible"
$env:OPENAI_COMPAT_BASE_URL="https://router.shengsuanyun.com/api/v1"
$env:OPENAI_COMPAT_API_KEY="你的胜算云 key"
$env:OPENAI_COMPAT_MODEL="deepseek/deepseek-v4-flash"
$env:OPENAI_COMPAT_PROVIDER_LABEL="shengsuanyun"
$env:PORT="4200"
npm run dev
```

启动后检查：

```powershell
Invoke-RestMethod http://localhost:4200/health | ConvertTo-Json -Depth 5
```

期望：

```json
{
  "ai": {
    "provider": "openai_compatible",
    "model": "deepseek/deepseek-v4-flash",
    "model_api_ready": true,
    "api_key_configured": true
  }
}
```

前端连接本地后端：

```powershell
cd D:\ReqClinic\ReqClinic
$env:NEXT_PUBLIC_API_TRANSPORT="http"
$env:NEXT_PUBLIC_API_BASE_URL="http://localhost:4200/api/v1"
npm run dev -- -p 3000
```

## 9. 数据库与持久化升级

### 9.1 已新增训练回合表

`training_questions` 继续只承担问题索引和披露命中记录；为了让真实浏览器体验支持刷新恢复，本轮新增训练专用 `training_turns`。该表只用于表达训练本轮练习恢复、角色回答展示和反馈上下文，不进入快速问诊、正式项目或项目实体。

当前落地结构：

```sql
training_turns(
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES training_attempts(id),
  role TEXT NOT NULL CHECK(role IN ('user','role','coach')),
  content TEXT NOT NULL,
  bound_refs_json TEXT NOT NULL DEFAULT '[]',
  coach_projection_json TEXT NOT NULL DEFAULT '{}',
  ai_job_id TEXT,
  created_at TEXT NOT NULL
)
```

原则：

1. 用户追问和角色回答可恢复，但严格隔离在训练域。
2. 总结正文仍只保存哈希，不保存明文。
3. 产品埋点仍不记录业务正文。
4. `ai_job_id + role` 做幂等保护，避免同一训练 job 重放时重复写入角色回答。

### 9.2 扩展 training_questions

当前 `training_questions` 保持轻量结构：

```sql
disclosure_rule_hit TEXT NULL
```

问题正文由 `training_turns` 保存用于恢复；`training_questions.disclosure_rule_hit` 继续记录本轮追问触发的披露规则。若后续要做重复提问、无意义提问或质量标签统计，可再增加 `question_hash` / `quality_label`，但首期浏览器验收不依赖这些字段。

### 9.3 反馈表保持现有方向

`training_feedback` 已经有：

1. `coverage_score_bp`
2. `missing_dimension_count`
3. `feedback_json`
4. `dimension_breakdown_json`
5. `improvement_examples_json`

只需约束 JSON schema，并让前端类型与后端响应统一。

## 10. 前端改造计划

### 10.1 类型对齐

统一前端类型：

```ts
interface TrainingAttempt {
  attempt_id: UUID;
  status: TrainingAttemptStatus;
  case_id: UUID;
  case_version: string;
  question_count: number;
  started_at: ISO8601;
  completed_at?: ISO8601 | null;
}
```

`createTrainingAttempt` 请求改为：

```ts
{
  case_id: UUID;
  case_version: string;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
}
```

### 10.2 删除本地假角色回答

`training-split-page.tsx` 中这些内容应迁移到后端：

1. `AI_CANNED_RESPONSES`
2. `TRAINING_PROFILES.responses`
3. `pickAiResponse`

前端可以保留“建议追问”的本地兜底，但真实链路应优先使用后端 `coach_projection.next_hint`。

### 10.3 对话等待态

发送追问后立即显示一条轻量等待态：

```text
对方正在回答，通常只需要几秒。
```

按钮状态：

1. 等待期间禁用重复发送。
2. 失败时恢复用户输入，不丢内容。
3. 模型不可用时提示：“当前真实练习暂未连接模型服务，可以稍后重试或返回案例页。”

### 10.4 右侧练习助手

训练右侧不使用正式项目地图，也不使用快速问诊卡片。推荐采用层次化练习面板：

1. 场景简介：公开背景。
2. 当前目标：本轮要练的表达能力。
3. 建议追问：可一键填入。
4. 提问记录：只显示次数和安全提示，不显示隐藏覆盖命中。
5. 总结草稿：用户整理自己的理解。
6. 提交反馈：生成本轮反馈。

### 10.5 移动端

移动端使用双 tab：

```text
[对话] [练习助手]
```

要求：

1. 输入框固定在对话页底部，不被浏览器键盘遮挡。
2. “填入追问”“发送”一屏内可见。
3. 练习助手页优先显示当前建议追问和总结草稿。
4. 反馈页卡片不横向溢出。

## 11. Prompt 与输出质量约束

### 11.1 角色回答 Prompt 原则

角色回答必须遵守：

1. 只回答用户问到的内容。
2. 不主动补全隐藏关键点。
3. 不把评分维度透露给用户。
4. 不用“作为 AI”之类说法。
5. 保持案例角色的人设和知识边界。
6. 用户问题无意义时，用角色口吻要求对方换一种问法。

无意义输入处理：

```text
用户：123123
角色：我没太理解你想问什么。你可以具体问目标、使用场景、限制条件或完成标准中的一个。
教练提示：这条追问还不像一个问题。建议先问“这件事最想达到什么结果？”
```

### 11.2 教练反馈 Prompt 原则

反馈必须遵守：

1. 先肯定已覆盖内容，再指出遗漏。
2. 每个遗漏都说明为什么影响需求质量。
3. 改进示例必须具体可复用。
4. 不把答案写成唯一标准答案。
5. 不使用开发者术语。
6. 不把本轮分数说成用户能力认证。

## 12. Schema Gate

新增 schema：

1. `trainingRoleAnswerOutputSchema`
2. `trainingCoverageUpdateSchema`
3. `trainingQuestionQualitySchema`
4. `trainingFeedbackOutputSchema`

`SCHEMA_GATES` 增加：

```ts
training_response: trainingRoleAnswerOutputSchema,
training_feedback: trainingFeedbackOutputSchema,
```

失败策略：

1. 角色回答模型失败：返回确定性兜底角色回复，不泄露答案。
2. 反馈模型失败：返回确定性覆盖检查报告。
3. Schema 失败：job 进入失败或重试，不能把不合格 JSON 写入反馈表。

## 13. Token 与审计

表达训练必须接入现有三层审计：

```text
ai_jobs
  -> agent_runs
    -> skill_runs
      -> ai_runs
```

每次训练追问：

1. `ai_jobs.scope_kind='training_attempt'`
2. `ai_jobs.task_type='training_response'`
3. `agent_runs.plan_id='training_practice'`
4. `skill_runs` 至少记录 `training.roleplay.answer` 和 `training.coaching.next_hint`
5. `ai_runs` 记录 provider、model、input/output token、thinking mode、usage 是否估算

每次训练总结：

1. `ai_jobs.task_type='training_feedback'`
2. `skill_runs` 记录 coverage、validation、composition
3. `training_feedback` 保存最终反馈结构

验收时必须输出：

```text
训练 attempt id
question job token
feedback job token
总 input token
总 output token
provider/model/thinking
usage 是否估算
```

## 14. 测试计划

### 14.1 后端单元测试

新增测试：

1. `training_practice` plan registry 能解析 `training_response` 和 `training_feedback`。
2. 所有 training skill manifest 声明完整。
3. `training_response` 输出通过 schema gate。
4. `training_feedback` 输出通过 schema gate。
5. 无意义问题不会触发隐藏事实披露。
6. 重复问题会得到自然提示，不重复加分。
7. 角色回答不能泄露 `answer_key`、`rubric`、`disclosure_rule`。
8. 总结反馈不能写入 `projects` 或 `quick_sessions`。
9. token 审计能从 job 汇总到 skill run。

### 14.2 后端集成测试

覆盖完整链路：

1. `GET /training-cases`
2. `POST /training-attempts`
3. `POST /training-attempts/:id/questions`
4. 轮询 `/ai-jobs/:jobId`
5. `GET /training-attempts/:id`
6. `POST /training-attempts/:id/summary`
7. 轮询反馈生成
8. `GET /training-attempts/:id/feedback`
9. `POST /training-attempts/:id/retry`
10. `POST /training-attempts/:id/complete`

### 14.3 前端工程验证

```powershell
cd D:\ReqClinic\backend
npm run typecheck
npm test

cd D:\ReqClinic\ReqClinic
npm run typecheck
npm run build
```

### 14.4 真实浏览器验收

必须用浏览器真实点击，不只用 DOM 断言。

桌面流程：

1. 首页点击表达训练。
2. 选择一个案例。
3. 点击“填入追问”。
4. 发送追问，等待 DeepSeek 角色回答。
5. 自己输入一条追问。
6. 输入无意义内容 `123123`，检查是否自然处理。
7. 写总结草稿。
8. 提交反馈。
9. 查看维度反馈、遗漏点、改进示例。
10. 点击重新练习。
11. 点击完成训练。

移动端 `390x844`：

1. 案例页首屏能看懂入口。
2. 对话页输入框不被遮挡。
3. “对话 / 练习助手”切换清楚。
4. 反馈页无横向溢出。
5. 底部按钮不互相遮挡。

### 14.5 输出质量评估

对 DeepSeek 输出按 1-5 分评估：

1. 角色一致性：是否像客户/老师/同事，而不是 AI 助手。
2. 披露控制：是否只回答问到的内容。
3. 训练价值：是否能引导用户问得更好。
4. 普通用户可读性：是否自然、少术语。
5. 反馈专业性：是否覆盖目标、对象、场景、边界、验收、风险等需求分析核心维度。
6. 总结纠错能力：能否发现用户总结里的臆测和遗漏。
7. 无泄露：不出现答案 key、内部状态、prompt 痕迹。

## 15. 分阶段实施与验收状态

### 阶段 0：接口与文档对齐（已完成）

目标：先把契约理顺，避免后面反复返工。

已完成：

1. 更新 `07-agent-skill-backend.md`，补充 `training_practice.v1`。
2. 更新 `03-api-design.md` 和 OpenAPI，决定 `postTrainingSummary` 是否改为 `202 + job_id`。
3. 将后端路由和前端类型实现对齐到公开版 `TrainingCaseVersionDetail`，确保前端不可见 `answer_key`。
4. 修正前端 Training API 类型字段。

验收：

1. OpenAPI 与前端类型一致。
2. 后端路由返回字段和前端使用字段一致。
3. 隐藏案例信息不再暴露给浏览器。

### 阶段 1：后端真实训练 Runtime（已完成）

目标：训练追问真实调用 DeepSeek。

已完成：

1. 新增 `training-schemas.ts`。
2. 新增 `training-runtime.ts`。
3. 新增 `training-job-executor.ts`。
4. `postTrainingQuestion` 改为创建真实 `ai_jobs`。
5. Job 完成后可返回 `training_response`。
6. 写入 `skill_runs` 和 `ai_runs` token 审计。

验收：

1. 选择案例后发送问题，DeepSeek 返回角色回答。
2. 无意义输入被自然处理。
3. 控制台无 error。
4. token 可查。

### 阶段 2：训练反馈真实生成（已完成）

目标：总结后真实生成反馈报告。

已完成：

1. `postTrainingSummary` 触发 feedback job。
2. Runtime 读取本轮追问、披露命中和用户总结。
3. 生成维度分数、遗漏点、改进追问和改进总结。
4. 写入 `training_feedback`。

验收：

1. 提交总结后进入等待态。
2. 反馈页展示结构化反馈。
3. 反馈不泄露隐藏答案全文，只解释训练结果。
4. 模型失败时有确定性兜底反馈。

### 阶段 3：前端体验精修（进行中）

目标：达到快速问诊和正式项目同等的审美、易用性和文案标准。

当前任务：

1. 已删除真实链路对本地 canned role response 的依赖。
2. 对话页已接 job 轮询、服务端消息和刷新恢复。
3. 移动端改成“对话 / 练习助手”切换。
4. 反馈页文案自然化。
5. 所有内部词替换为普通用户语言。

验收：

1. 新用户 5 秒内知道表达训练是做什么。
2. 每一步知道下一步点哪里。
3. 等待态明确但不夸张。
4. 页面不闪烁、不空白、不遮挡。

### 阶段 4：真实浏览器验收（当前执行标准）

目标：用真实浏览器完成端到端验收。

任务：

1. 桌面全链路。
2. 移动端全链路。
3. 特殊输入。
4. 刷新和返回恢复。
5. token 统计。
6. P0-P3 问题修复。

验收：

1. 无 P0/P1。
2. P2 只剩不影响演示的小问题。
3. 视觉和文案达到快速问诊当前标准。
4. DeepSeek 输出质量平均不低于 4/5。

## 16. 验收标准

最终完成时必须满足：

1. 首页可进入表达训练。
2. 案例页非空，案例区分度清楚。
3. 案例点击后直接进入练习，不多一个无意义入口页。
4. 训练追问调用真实后端，不再使用前端 canned response。
5. AI 角色回答自然、具体、不泄露隐藏答案。
6. 用户无意义输入被温和拦截或引导。
7. 总结反馈由真实 job 生成，并有确定性兜底。
8. 反馈页能明确告诉用户问到了什么、漏了什么、下次怎么问。
9. 表达训练不写入 quick 或 formal 数据。
10. token、provider、model、thinking、usage estimated 可审计。
11. 浏览器桌面和移动端验收通过。
12. 页面不出现内部词：`attempt`、`training_response`、`rubric`、`disclosure_rule`、`answer_key`、`stub`、`custom/sample`。

## 17. 当前优先级

当前不再从零实现，优先级改为：

1. 真实浏览器完整验收首页进入、案例选择、追问、总结、反馈、再练一次和完成练习。
2. 检查无意义追问、重复点击、刷新恢复、返回再进入、移动端切换和错误态。
3. 审查用户可见文案，删除内部词和原型感描述。
4. 检查 DeepSeek 输出质量、反馈专业度和普通用户可读性。
5. 记录训练 job 的 provider、model、thinking 和 token 审计。

原因：表达训练最容易出问题的不是接口是否存在，而是“训练测量被泄露”“反馈不够可学”和“页面看起来像原型”。后端边界已建立，后续重点转为真实体验质量。
