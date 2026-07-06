# 需求问诊室 · API 设计

> 文档状态：v1.3（对齐 PRD v2.3 / ADD v1.5 当前实现补充）
> 适用阶段：真实 HTTP 后端 + MockTransport 演示双轨；快速问诊、正式项目首期和表达训练首期已接真实 Job
> 更新日期：2026-07-05
> OpenAPI 3.1：[03-api-openapi.yaml](./03-api-openapi.yaml)
> 校验结果：Redocly recommended profile：0 错误、0 警告；106 个 operationId 唯一、238 个 Schema、1198 个内部引用均可解析
> 上游约束：[PRD](./01-PRD.md)、[ADD](./02-architecture.md)
> 存储实现：[数据库设计](./04-database-design.md)

> **v1.1 主要变更**：删除用户级数据处理方式选择；游客 `session_key` 改为摘要存储，原始凭证只签发一次（HttpOnly/Secure/SameSite Cookie）；游客认领要求登录上下文与游客凭证双重证明；新增 §2.4 异步 AI 任务响应模式，8 个 AI 端点统一返回 202 + job_id。v1.2 进一步删除来源级策略字段。

> **v1.2 主要变更**：统一异步任务路径为 `/api/ai-jobs/:id`，并允许按正式项目/快速会话/训练尝试作用域安全轮询；协议操作人完全来自认证上下文；认领粒度改为指定快速问诊会话；产品埋点身份与认证凭证分离并增加版本化 `attributes`；新增删除任务查询；补齐页面恢复所需的快速问诊消息/简报版本、正式项目历史、冲突详情和训练状态读契约；清理项目模式及项目/来源出站策略，真实 AI 仅校验有效协议同意；统一临时导出为 24 小时。

> **v1.2 演示链路实现澄清**：本契约同时作为 Mock Route 的唯一线协议。演示页面通过同一类型化 API Client 调用浏览器内 `MockTransport`，不连接本文 `servers`、数据库或真实模型；该澄清不新增或修改线协议字段。

> **v1.3 当前实现对齐**：当前仓库已支持 `HttpTransport` 连接真实 `/api/v1` 后端。快速问诊自定义链路通过 `quick_sessions + ai_jobs + QuickJobExecutor + quick Skill Runtime` 运行；正式项目建档和快速简报升级通过 `formal_guidance` Job 生成正式项目需求地图；表达训练通过 `training_attempts + ai_jobs + TrainingJobExecutor + training Skill Runtime` 生成角色回答和教练反馈。训练恢复、隐藏案例信息和浏览器验收计划见 [08-expression-training-development-plan.md](./08-expression-training-development-plan.md)。

### v1 主要变更说明（相对 v1-rc）

- 覆盖三种产品模式端点：快速问诊（P0 默认主路径，§5A）、表达训练（P2，§12A）、正式项目（原 §5–§11 不变）；
- 新增游客身份与认领端点（§3A，ADR-021）、协议同意记录端点（§3B，ADR-020）、升级操作原子端点（§5A.15，ADR-022）、需求简报视图与导出端点（§5A.8–5A.12）；
- 新增产品埋点事件入口与最小 SQL 报表端点（§12B，对齐 PRD §12.5 / ADD §18.3）；
- §2 通用约定引入 `actor_kind` 分层鉴权与协议同意前置；§3 身份与能力补充分层鉴权说明；§4 核心枚举扩展快速问诊、训练、协议与覆盖槽位枚举；
- §12 错误码新增 `AGREEMENT_REQUIRED`、`UPGRADE_FAILED`、`QUICK_SESSION_CLAIMED`、`TRAINING_CASE_NOT_FOUND`、`BRIEF_VERSION_NOT_FOUND`、`COVERAGE_INSUFFICIENT`；
- §13 PRD ID 追踪表从 10 项扩展到 32 项，对齐 ADD §23.5；
- 所有触发真实 AI 的端点（创建项目、分析运行、编译报告、快速问诊）补协议同意校验，未同意返回 `403 AGREEMENT_REQUIRED`。

## 1. 职责与边界

本文定义目标 HTTP 语义，以及 MockTransport 对同一线协议的演示使用规则，覆盖快速问诊（P0）、正式项目（P1）和表达训练（P2）三种产品模式，并与 [OpenAPI 3.1 线协议](./03-api-openapi.yaml)共同构成 API v1 契约。Markdown 解释业务语义，OpenAPI 负责可生成客户端的路径、字段、必填性和状态码；两者差异属于阻断缺陷。ADD 中的端点只表示模块边界；FSD 不能通过前端状态替代服务端校验。

当前实现是双轨：真实链路通过 ApiClient + HttpTransport 调用 `/api/v1`；演示链路通过 ApiClient + MockTransport 调用相同 operation 契约。演示链路中的自定义输入只保存在浏览器 Draft Store，不能发送给 Mock 分析 operation，也不能显示为服务器项目或真实分析结果；真实链路中的自定义输入可以创建快速问诊会话，正式项目由 `/formal/new` 或快速简报升级创建。

### 1.1 MockTransport 与 HttpTransport 使用规则

- MockTransport 与 HttpTransport 共用同一类型化 ApiClient、`operationId`、请求类型、响应类型和错误类型；页面组件不得维护第二套“Demo 专用 API”；
- `MockTransport` 在浏览器内拦截调用，并根据 Mock Route Registry 从版本化 Fixture Store 和本地 Mock Session Store 返回结果，不访问 OpenAPI `servers`；
- 每个 Mock handler 必须绑定一个 OpenAPI `operationId`，校验请求，并只返回该 operation 声明的状态码、响应信封和错误体；
- `202 + job_id`、`queued/running/succeeded/failed`、身份、协议、删除、恢复和限流等均可按固定场景脚本模拟，以覆盖页面正常、加载、失败和恢复状态；
- Mock 游客凭证、登录、协议同意和删除任务只表示本地演示状态，不签发真实 Cookie/令牌，不形成法律记录，不执行数据库事务或服务器物理删除；
- 自定义输入由独立 Draft Store 保存。Mock 分析 handler 只能接受案例注册表中允许的 Fixture 会话，不得把任意用户输入套入预生成案例输出；
- 未注册 operation、Schema 不匹配和任何指向开发/生产业务 API 的网络请求必须立即失败，不能静默回退到 HttpTransport；
- 传输实现由环境和构建目标注入：演示/回归可使用 MockTransport，真实开发与验收使用 HttpTransport。生产构建不得通过 URL 参数、本地开关或用户操作切换到 Mock；
- 契约测试必须遍历所有已启用 Mock handler，验证请求/响应 Schema、允许状态和错误示例，并验证切换到 HttpTransport 不需要修改页面组件或状态机事件。

## 2. 通用约定

- 生产基础路径：`/api/v1`；本文端点为便于阅读使用 `/api` 作为该基础路径的占位符，OpenAPI 中必须展开为 `/api/v1`；媒体类型：`application/json; charset=utf-8`；
- ID 为服务端生成的稳定不透明字符串；时间为 UTC ISO 8601；
- 所有真实项目端点要求认证会话，并按项目成员能力授权；
- 写命令携带 `Idempotency-Key`。同一用户、端点、键和请求哈希返回首次结果；请求哈希不同返回 `409 IDEMPOTENCY_CONFLICT`；
- 修改现有对象携带 `expected_version`；版本不一致返回 `409 VERSION_CONFLICT`；
- 列表使用 `limit` 与不透明 `cursor`，默认 50，最大 200；
- 响应只返回当前用户有权查看的字段；内部 Prompt、模型推理、密钥和文件系统路径永不返回。

### 2.1 actor_kind 分层鉴权

调用方身份分为两类 `actor_kind`（对齐 ADD §17.4、ADR-021）：

| actor_kind | 标识方式 | 可调用端点 |
|---|---|---|
| `guest` | 凭 `session_key`（不可直接识别个人）标识，不要求注册 | 快速问诊端点（§5A）、表达训练端点（§12A）、产品埋点端点（§12B）、协议同意与游客会话端点（§3A/§3B） |
| `user` | 通过正式登录认证 | 上述全部端点 + 正式项目端点（§5–§11，需 `project_members` 能力）+ 升级端点（§5A.15） |

约束：

- `session_key` 不可是邮箱、电话或姓名；清除凭证、换浏览器或换设备后，系统不承诺恢复未绑定账户的游客数据；
- 跨设备历史、长期保存、升级正式项目和团队协作必须 `actor_kind=user`；正式项目不能归属于游客身份。当前本地开发和演示环境允许通过受控 guest formal owner bridge 体验正式项目，但这是开发便利层，不放宽生产授权语义；
- 游客登录后只把显式认领的快速问诊会话转为 `user` 所有，保留该会话 ID、版本和协议来源；同一游客身份下其他会话与训练记录不变；
- 快速问诊端点允许 `actor_kind=guest` 或 `actor_kind=user` 调用；正式项目端点要求 `actor_kind=user` 且具备对应 `project_members` 能力；训练端点允许 `actor_kind=guest` 或 `actor_kind=user`。

### 2.2 协议同意前置

所有进入真实 AI 流程或直接触发模型调用的端点必须先校验有效 `agreement_consents` 记录（对齐 ADD §17.5、ADR-020、PRD §10.2）。其中创建会话、开始训练和升级可先完成确定性事务，但仍作为用户进入真实 AI 流程的同意关口：

- 首次使用真实 AI 前必须勾选"已阅读并同意服务与数据处理协议"；未同意时不能提交真实 AI 问诊、分析运行或报告编译；
- 重大更新生效后，用户下一次发起新的真实 AI 调用前必须重新同意；页面保留其输入并说明变化，不得把继续浏览视为同意；
- 非重大更新可以通知用户，既有有效同意继续有效；
- 撤回后立即阻止新的模型调用，并取消尚未发送给模型供应商的排队任务；
- 未同意有效协议时调用以下端点返回 `403 AGREEMENT_REQUIRED`：`POST /api/projects`（§5.1）、`POST /api/projects/:id/analysis-runs`（§8.1）、`POST /api/projects/:id/reports`（§10.3）、`POST /api/quick-sessions`（§5A.1）、`POST /api/quick-sessions/:id/messages`（§5A.3）、`POST /api/quick-sessions/:id/understanding-review`（§5A.5）、`POST /api/quick-sessions/:id/option-preferences`（§5A.7）、`POST /api/quick-sessions/:id/briefs`（§5A.8）、`POST /api/quick-sessions/:id/upgrade`（§5A.15）、`POST /api/training-attempts`（§12A.3）、`POST /api/training-attempts/:id/questions`（§12A.4）。

成功响应：

```json
{
  "data": {},
  "meta": { "request_id": "REQ_..." }
}
```

错误响应：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "details": [{ "field": "expected_version", "reason": "stale" }],
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

### 2.3 应用层限流、超时与排队

应用层自身（非外部模型）的限流、超时和排队策略，对齐 ADD §18.1 的 P75/P95 非功能目标：

**限流（按 actor_kind + 操作类别）**：

| 作用域 | 操作 | 真实 HTTP 试点默认上限 | 超限响应 | 说明 |
|---|---|---|---|---|
| 单游客 session_key | 创建快速问诊会话 | 5 次/小时 | `429 RATE_LIMITED` | 防止匿名滥用 |
| 单游客 session_key | 提交追问/回答 | 60 次/小时 | `429 RATE_LIMITED` | 含 AI 调用 |
| 单用户 user | 创建快速问诊会话 | 20 次/小时 | `429 RATE_LIMITED` | 登录用户放宽 |
| 单用户 user | 创建正式项目 | 10 次/小时 | `429 RATE_LIMITED` | 含建档开销 |
| 单用户 user | 触发真实 AI（所有端点合计） | 100 次/小时 | `429 RATE_LIMITED` | 合并计数 |
| 单用户 user | 提交训练追问 | 120 次/小时 | `429 RATE_LIMITED` | 轻量交互 |
| 单 IP | 未认证请求（含游客签发） | 300 次/小时 | `429 RATE_LIMITED` | 反爬基础 |
| 单项目 | 并发未完成 AI Job | 3 个 | `429 MODEL_BUSY` | 防止单项目打满队列 |

- 限流为滑动窗口，响应头携带 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`；
- `429 RATE_LIMITED` 响应体含 `retry_after_seconds`，`retryable=true`；
- 限流维度和默认值在真实 HTTP 试点后按实测调整，配置化不写死在代码常量中。

**超时阈值**：

| 操作 | 默认超时 | 超时处理 |
|---|---|---|
| HTTP 请求整体（非 AI 写命令） | 30s | 返回 `504 REQUEST_TIMEOUT`，请求标记失败，不影响已写入数据 |
| AI 写命令 HTTP 响应 | 1s | 立即返回 `202 + job_id`（不等待 AI 结果）；超过 1s 未响应标记为客户端超时 |
| AI Job 单次模型调用 | 90s | 标记 Job 失败，按重试策略退避重试（最多 3 次） |
| 报告编译 | 180s | 同上，但编译失败不产生半成品快照 |
| 游客会话认领 | 10s | 返回 `504 REQUEST_TIMEOUT`，保留游客访问 |
| 协议同意写入 | 5s | 返回 `504 REQUEST_TIMEOUT`，不写入半条同意记录 |

- AI 写命令不使用同步 200/201 等待 AI 结果；客户端通过轮询 `GET /api/ai-jobs/:id` 获取最终状态；
- 超时后服务端保证幂等：同 `Idempotency-Key` 重试返回首次结果或最新 Job 状态。

**排队与降级**：

- AI Job 按作用域优先级和提交时间排队；`blocking` 任务优先；
- 队列上限 100 个未完成 Job，超限新提交返回 `429 QUEUE_FULL`，`retryable=true`；
- DeepSeek 不可用时，快速问诊返回 `503 MODEL_UNAVAILABLE` 并保留用户输入；正式项目 Job 标记 `failed`，不自动降级为 Flash 跑 Pro 任务；
- 限流和超时事件计入 `product_events`（`error_presented`），用于容量规划。

新增错误码：

| HTTP | 错误码 | 含义 |
|---:|---|---|
| 429 | `RATE_LIMITED` | 应用层限流，按 `retry_after_seconds` 重试 |
| 429 | `MODEL_BUSY` | 单项目并发 AI Job 达上限 |
| 429 | `QUEUE_FULL` | 全局队列满，稍后重试 |
| 504 | `REQUEST_TIMEOUT` | 请求超时，AI 命令可轮询 Job 状态 |

### 2.4 异步 AI 任务响应模式

所有触发真实模型调用的端点（下表"AI 写命令"）统一返回 `202 Accepted` + `job_id`，**不在 HTTP 响应中等待 AI 结果**。客户端通过轮询 `GET /api/ai-jobs/:id` 获取最终状态和结果。对齐 PRD §10.3 "AI 任务 1 秒内确认"和 ADD §18.1 P75/P95 目标。

**AI 写命令清单**：

| 端点 | 说明 | Job 结果类型 |
|---|---|---|
| `POST /api/projects`（创建项目） | 初始候选生成 | `project_candidates` |
| `POST /api/projects/:id/analysis-runs` | 分析运行 | `analysis_result` |
| `POST /api/projects/:id/reports` | 报告编译 | `report_snapshot` |
| `POST /api/quick-sessions/:id/messages`（`action=answer`） | 快速问诊追问 | `next_question` |
| `POST /api/quick-sessions/:id/understanding-review` | 理解确认 | `understanding_updated` |
| `POST /api/quick-sessions/:id/option-preferences` | 记录方案偏好 | `option_comparison` |
| `POST /api/quick-sessions/:id/briefs` | 生成简报 | `brief_version` |
| `POST /api/training-attempts/:id/questions` | 训练追问 | `training_response` |

**统一 202 响应格式**：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_...",
    "estimated_duration_seconds": 15
  },
  "meta": { "request_id": "REQ_..." }
}
```

**Job 状态机**：`queued → running → validating → succeeded`；可恢复失败进入 `retry_wait` 后重新排队，需要人工处理时进入 `manual_review`，不可恢复错误进入 `failed`，未完成任务可进入 `cancelled`。

- `queued`：已入队等待执行；
- `running`：模型调用进行中；
- `validating`：模型结果正在执行 Schema、引用和业务规则校验；
- `retry_wait`：可恢复失败，等待下一次受限重试；
- `manual_review`：自动校验无法安全决定，等待人工处理；
- `succeeded`：结果已就绪，`result` 字段包含最终数据；
- `failed`：执行失败，`error` 字段包含失败原因；
- `cancelled`：用户撤回同意或超时取消。

**轮询端点**：`GET /api/ai-jobs/:id`

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "succeeded",
    "result": { /* 端点特定结果，对应上表"Job 结果类型" */ },
    "created_at": "2026-07-01T10:00:00Z",
    "completed_at": "2026-07-01T10:00:12Z",
    "duration_ms": 12340
  },
  "meta": { "request_id": "REQ_..." }
}
```

**轮询策略**：客户端采用 `2s → 4s → 8s → 16s → 30s` 的指数退避，最长主动轮询 10 分钟。客户端停止轮询不改变服务端 Job 状态；用户稍后刷新仍可继续查询。单次模型调用超过服务端 90 秒限制时，才按重试策略进入 `retry_wait` 或最终 `failed`。

**幂等保证**：同 `Idempotency-Key` 重试返回同一 `job_id`，不创建第二个 Job。Job 完成后重试返回首次结果。

**AgentPlan 内部映射**：`task` / `task_type` 是 API 与队列层稳定契约，不向客户端暴露 Agent 或 Skill。真实后端在创建 `ai_jobs` 后，根据 `scope_kind + task_type + 当前状态 + domain_profile` 映射到固定 `agent_plan_id + plan_version`，由单 Orchestrator Agent 执行版本化 Skill。客户端仍只看到 `job_id`、Job 状态和端点特定结果；AgentRun、SkillRun、Prompt、模型和 DomainPack 版本只进入服务端审计与调试权限视图。完整约束见 [07-agent-skill-backend.md](./07-agent-skill-backend.md)。

## 3. 身份与能力

最小角色为 `Owner | Editor | Reviewer | Viewer | Exporter`。服务端按能力而非角色名称硬编码判定：

| 能力 | Owner | Editor | Reviewer | Viewer | Exporter |
|---|:---:|:---:|:---:|:---:|:---:|
| 读取项目 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 编辑内容/发起分析 | ✓ | ✓ |  |  |  |
| 执行人工关口 | ✓ |  | ✓ |  |  |
| 管理成员 | ✓ |  |  |  |  |
| 编译报告草稿 | ✓ | ✓ | ✓ |  |  |
| 发布报告 | ✓ |  | ✓ |  |  |
| 下载报告 | ✓ |  | ✓ |  | ✓ |

单用户部署仍创建真实用户和成员记录。对象 ID 猜测不能绕过成员校验。

### 3.1 分层鉴权说明

上表为正式项目端点的角色能力矩阵。三种产品模式采用分层鉴权（对齐 ADD §17.4、ADR-021）：

| 端点类别 | 鉴权要求 |
|---|---|
| 快速问诊端点（§5A） | `actor_kind=guest`（凭 `session_key`）或 `actor_kind=user`；不要求 `project_members` |
| 正式项目端点（§5–§11） | `actor_kind=user` 且具备对应 `project_members` 能力（见上表） |
| 训练端点（§12A） | `actor_kind=guest` 或 `actor_kind=user`；不要求 `project_members` |
| 游客会话端点（§3A） | 签发不要求认证；认领需 `actor_kind=user` |
| 协议同意端点（§3B） | `actor_kind=guest` 或 `actor_kind=user` |
| 身份认证端点（§3C） | 会话读取/退出/恢复触发；具体登录、注册、OAuth/OIDC 回调由身份模块实现 |
| 升级端点（§5A.15） | `actor_kind=user`（游客不能创建正式项目） |
| 产品埋点端点（§12B） | `actor_kind=guest` 或 `actor_kind=user` |

正式项目访问还需有效 `project_members` 关系；项目 ID 不构成授权，任何读取、修改、确认、导出和 AI 调用均验证成员能力，越权尝试写入安全审计。

## 3A. 游客会话与认领

游客在同一浏览器中同意协议后，可以完成真实快速问诊、恢复当前会话、复制和下载当前简报，不要求先注册（对齐 ADD §17.4、ADR-021、PRD §10.2）。

### 3A.1 签发游客会话

`POST /api/guest-sessions`。该端点在签发前尚无稳定 actor，不使用通用 `idempotency_records`；每次成功调用签发一个新游客会话。客户端收到响应前断线时可以重新签发，新旧空会话按 30 天规则清理，不把 IP 地址当成幂等身份。

**请求**：无请求体。客户端版本、语言等非身份信息如需记录，统一通过产品埋点契约提交，不附着在认证凭证签发请求上。

**响应**（`201`）：

```json
{
  "data": {
    "id": "GST_...",
    "session_key": "sk_...",
    "created_at": "2026-07-01T08:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：

- `session_key` 为不可直接识别个人的会话凭证，不可是邮箱、电话或姓名；
- **原始 `session_key` 只在签发时返回一次**，数据库只存 `HMAC-SHA-256(server_pepper, session_key)` 摘要；后续任何端点不再返回原始凭证；
- 签发响应同时通过 `Set-Cookie` 下发名为 `guest_session`、值为原始 `session_key` 的 Cookie，标记 `HttpOnly; Secure; SameSite=Strict`，浏览器后续请求自动携带；
- 清除凭证、换浏览器或换设备后，系统不承诺恢复未绑定账户的游客数据；
- 指定快速会话认领后不再接受游客凭证访问，改用用户认证；原游客凭证仍可访问同一游客身份下未认领的其他数据，直至其自身过期或被撤销。

### 3A.2 恢复当前会话

`GET /api/guest-sessions/current`，通过 `guest_session` Cookie 或 `X-Session-Key` Header 认证。**响应不返回 `session_key`**（原始凭证只签发一次）。

**响应**（`200`）：

```json
{
  "data": {
    "id": "GST_...",
    "created_at": "2026-07-01T08:00:00Z",
    "last_active_at": "2026-07-01T10:30:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

会话不存在或凭证无效时返回 `404 RESOURCE_NOT_FOUND`。

### 3A.3 认领指定快速问诊会话

`POST /api/quick-sessions/:id/claim`，需 `Idempotency-Key`；`:id` 是要认领的快速问诊会话 ID。

**双重证明**：认领要求同时证明（1）登录身份有效（从 Bearer 或用户会话 Cookie 取得）；（2）持有该快速会话当前 `guest_session_id` 对应的游客凭证（浏览器通过 HttpOnly `guest_session` Cookie 自动携带，非浏览器客户端可用 `X-Session-Key`）。命令不认领整个浏览器游客身份，也不影响同一游客身份下其他问诊或训练记录。

**请求**：无请求体。登录身份与游客凭证必须通过两套认证信息同时提交；客户端不得在 JSON 中重复提交用户 ID 或 `session_key`。服务端对游客凭证计算 `HMAC-SHA-256(server_pepper, session_key)`，与 `quick_sessions.guest_session_id → guest_sessions.session_key_digest` 等值校验；原始凭证和认证头不得进入日志。

**响应**（`200`）：

```json
{
  "data": {
    "quick_session_id": "QS_...",
    "user_id": "USR_...",
    "origin_guest_session_id": "GST_...",
    "claimed_at": "2026-07-02T11:00:00Z",
    "expires_at": "2026-12-29T11:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应不返回 `session_key`**。认领后该快速会话改用用户认证；原游客凭证仍可访问同一游客身份下尚未认领的其他数据。

**约束**：

- 认领必须原子、幂等，保留 `quick_session.id`、问答、简报版本和协议来源，不复制为第二份会话；
- 账户已有其他会话时分别保留，不静默合并内容；
- 同一事务把当前所有者从 `guest_session_id` 切换为 `user_id`，保存 `origin_guest_session_id`、写入 `claimed_at`、更新 180 天账户保留期并记录审计；历史同意记录不改写原操作身份；
- 认领失败时原游客所有权和 30 天期限保持不变，允许安全重试，不得产生半绑定状态；
- 凭证与会话不匹配时返回 `403 SESSION_CREDENTIAL_MISMATCH`。

**错误示例**：

```json
{
  "error": {
    "code": "QUICK_SESSION_CLAIMED",
    "message": "该快速问诊会话已被其他用户认领。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

已被其他用户认领时返回 `409 QUICK_SESSION_CLAIMED`；失败保留游客访问和全部版本。

## 3B. 协议同意

真实 AI 使用以有效协议同意为前提（对齐 ADD §17.5、ADR-020、PRD §10.2）。协议正文属于单独法律任务，本节只定义协议版本和同意记录的端点契约。

### 3B.1 获取当前有效协议版本

`GET /api/agreements/active`：返回当前有效协议版本。

**响应**（`200`）：

```json
{
  "data": {
    "id": "AGV_...",
    "version": "2026.07",
    "change_type": "major",
    "effective_at": "2026-07-01T00:00:00Z",
    "content_ref": "https://example.com/agreements/2026.07"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `data.id` | string | 协议版本 ID ← `agreement_versions.id` |
| `data.version` | string | 协议版本号 ← `agreement_versions.version` |
| `data.change_type` | string | 更新类型：`major` / `minor` ← `agreement_versions.change_type` |
| `data.effective_at` | string | 生效时间 ← `agreement_versions.effective_at` |
| `data.content_ref` | string | 协议正文引用 ← `agreement_versions.content_ref` |

### 3B.2 首次或非重大更新同意

`POST /api/agreements/:versionId/accept`，需 `Idempotency-Key`。

**请求**：

```json
{
  "scope": "quick"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `scope` | string | 是 | 适用范围 ← `agreement_consents.scope` |

`actor_kind` 和操作人 ID 必须从 Bearer/Cookie/游客会话认证上下文派生，客户端不得提交。服务端分别写入 `agreement_consents.user_id` 或 `guest_session_id`；请求体身份字段即使出现也必须因 `additionalProperties:false` 被拒绝。

**响应**（`201`）：

```json
{
  "data": {
    "consent_id": "AGC_...",
    "agreement_version_id": "AGV_...",
    "action": "accepted",
    "occurred_at": "2026-07-01T08:05:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：未同意时不能提交真实 AI 问诊（返回 `403 AGREEMENT_REQUIRED`）；同意后系统默认可以按已同意协议调用云端 AI，不再显示额外的数据处理方式选项。

### 3B.3 重大更新后重新同意

`POST /api/agreements/:versionId/reaccept`，需 `Idempotency-Key`。

请求与 `accept` 一致，但 `action=reaccepted`。

**响应**（`201`）：

```json
{
  "data": {
    "consent_id": "AGC_...",
    "agreement_version_id": "AGV_...",
    "action": "reaccepted",
    "occurred_at": "2026-07-01T08:10:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：重新同意形成新记录，不覆盖旧版本记录，也不追溯改变旧处理行为的合法性状态；判断标准和审批责任由法律任务定义，产品不能自行把重大更新降级。

### 3B.4 撤回同意

`POST /api/agreements/consents/:id/withdraw`，需 `Idempotency-Key`。

**响应**（`200`）：

```json
{
  "data": {
    "consent_id": "AGC_...",
    "action": "withdrawn",
    "occurred_at": "2026-07-01T12:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：

- 只能撤回当前认证主体自己的同意记录；资源不存在和无权访问统一返回不可枚举的 `404 RESOURCE_NOT_FOUND`；
- 撤回后立即阻止新的模型调用，并取消尚未发送给模型供应商的排队任务；
- 已经发送的进行中调用可能无法撤回，系统必须明确提示，允许其结束并按既定保留策略处理结果，但不得自动发起后续模型调用；
- 撤回同意不等于删除数据，用户需要单独发起删除；
- 撤回同意不新增 AI 事件。

### 3B.5 查询当前主体的协议记录

`GET /api/agreements/consents`，支持标准 `limit/cursor` 分页。服务端只返回当前认证用户或游客主体自己的记录；操作人 ID 从认证上下文派生，不接受主体筛选参数。

**响应**（`200`）：`data` 为版本化同意/重新同意/撤回记录数组，`meta` 返回 `request_id/cursor/has_more`。游客登录并认领指定快速会话后，历史记录仍显示原 `actor_kind=guest`，不改写原操作身份。

### 3B.6 错误码

- `AGREEMENT_REQUIRED`（`403`）：未同意有效协议时触发 AI 调用（详见 §12）。

## 3C. 登录会话、退出与账户恢复边界

登录、注册、多因素认证、OAuth/OIDC 回调和企业身份集成不是需求工程业务流程的一部分，由独立身份模块或部署所选认证框架实现。产品前端只依赖以下三个稳定契约，用于渲染账户状态、退出登录和发起账户恢复。

### 3C.1 获取当前登录会话

`GET /api/auth/session`：返回前端渲染所需的登录状态、用户摘要和能力标记。未登录时返回 `authenticated=false`，不返回 401。

**响应**（`200`）：

```json
{
  "data": {
    "authenticated": true,
    "user": {
      "id": "USR_...",
      "display_name": "张三",
      "email": "zhangsan@example.com"
    },
    "capabilities": ["create_project"]
  },
  "meta": { "request_id": "REQ_..." }
}
```

### 3C.2 退出登录

`POST /api/auth/logout`：清除当前用户会话 Cookie/Token。未登录时返回成功的无副作用响应，不影响游客 Cookie，也不删除快速问诊或训练数据。

**响应**（`200`）：

```json
{
  "data": { "logged_out": true },
  "meta": { "request_id": "REQ_..." }
}
```

### 3C.3 发起账户恢复

`POST /api/auth/recovery/start`：发起账户恢复或找回流程。具体邮件、短信、通行密钥或企业身份验证方式由身份模块实现；响应不得泄露账户是否存在。

**请求**：

```json
{
  "account_hint": "zhangsan@example.com"
}
```

**响应**（`202`）：

```json
{
  "data": {
    "accepted": true,
    "message": "如果账户存在，恢复指引将发送到已绑定的验证方式。"
  },
  "meta": { "request_id": "REQ_..." }
}
```

## 4. 核心枚举

```text
ProjectStatus = Draft | Ingesting | Eliciting | Reviewing | Baselined | Reporting | Released | Changing | Archived
EpistemicType = Fact | Inference | Assumption | Proposal | Unknown | Conflict | Decision
DescriptiveEpistemicType = Fact | Inference | Assumption | Proposal
RequirementProvenance = explicitly_stated | derived | assumed | proposed
DriverType = goal | outcome | obligation | risk | problem | opportunity
ReviewAction = accept | modify | reject | uncertain
AnalysisTimeframe = as_is | now | next | later | watch
RequirementHorizon = now | next | later | watch
ScopeDisposition = included | excluded
RequirementStatus = candidate | supported | reviewed | accepted | implemented | verified | superseded | retired
DomainProfileStatus = candidate | under_review | approved | rejected | superseded
JobStatus = queued | running | validating | retry_wait | succeeded | failed | manual_review | cancelled
ReportStatus = draft | gate_failed | rendering | staged | ready | released | publish_failed | superseded
QuickSessionStatus = draft | clarifying | understanding_review | option_review | brief_ready | upgraded | archived
TrainingAttemptStatus = not_started | interviewing | summarizing | feedback_ready | retrying | completed
BriefViewType = simple | exec
AgreementAction = accepted | reaccepted | withdrawn
AgreementChangeType = major | minor
ActorKind = guest | user
CoverageSlot = expected_outcome | user_object | core_scenario | scope_boundary | completion_criteria | constraints_risks
QuickSessionSourceKind = custom | sample | training_fixture | internal_test
```

`EpistemicType` 是概念层的完整认识状态；`DescriptiveEpistemicType` 只用于 Outcome、Job、Capability 等描述性实体的 `epistemic_type` 列。`Unknown`、`Conflict` 和 `Decision` 在正式项目中保存为独立实体，并通过 TraceLink 或业务外键关联，不写入这些描述性实体的 `epistemic_type` 列。

`As-Is` 只用于现状分析，不是 Requirement 的 `horizon`；"不做"保存为 `ScopeDisposition=excluded`，不是时间值。Requirement 是规范性陈述，使用 `RequirementProvenance` 而不是 Fact/Inference。`RequirementHorizon`、`ScopeDisposition` 与 `RequirementStatus` 相互独立。项目和来源均不定义数据出站枚举；真实 AI 调用统一由有效协议同意控制。

`QuickSessionStatus`、`TrainingAttemptStatus` 与 `ProjectStatus` 分别对应三种产品模式的独立状态机，不得互相冒充或映射（对齐 ADD §12、ADR-019）。`CoverageSlot` 为快速问诊六类信息覆盖槽位（对齐 PRD §5.3）。`QuickSessionSourceKind` 区分自定义、样例、训练/评估 Fixture 和内部测试；普通用户入口只暴露 `custom/sample`，默认产品指标排除 `internal_test`。`BriefViewType` 为需求简报两类投影视图：`simple`（概述）和 `exec`（详细报告）（对齐 PRD §5.6）。`ActorKind` 区分游客与认证用户（对齐 §2.1）。`AgreementAction` 与 `AgreementChangeType` 用于协议同意记录（对齐 §3B）。

### 4.1 domain_pack_version 格式规范

所有需要指定领域包版本的端点使用统一的版本格式：

- **格式**：`{pack_id}@{version}`，例如 `software-delivery@1.0.0`
- **精确匹配**：版本必须精确匹配 `domain_packs` 表中的 `version` 字段，不支持 `@latest`、`@^1.0.0` 等语义版本范围
- **错误处理**：当指定版本不存在时，返回 `404 RESOURCE_NOT_FOUND`，`details` 中包含 `pack_id` 和 `version` 字段：

  ```json
  {
    "error": {
      "code": "RESOURCE_NOT_FOUND",
      "message": "领域包版本不存在。",
      "details": [
        { "pack_id": "software-delivery", "version": "9.9.9" }
      ],
      "retryable": false,
      "request_id": "REQ_..."
    }
  }
  ```

- **适用范围**：该格式适用于所有需要指定领域包版本的端点，包括分析运行（`domain_pack_versions` 字段）、激活/停用操作等

## 5. 项目与建档

### 5.1 创建项目

`POST /api/projects`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "initial_request": "我们需要……",
  "name": null,
  "decision_intent": null,
  "selected_work_type": null,
  "candidate_roles": [],
  "candidate_constraints": []
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `initial_request` | string | 是 | 原始需求描述 ← `project_intakes.original_text` |
| `name` | string\|null | 否 | 项目名称 ← `projects.name` |
| `decision_intent` | string\|null | 否 | 决策意图 ← `project_intakes.decision_intent` |
| `selected_work_type` | string\|null | 否 | 选定的工作类型 ← `project_intakes.selected_work_type` |
| `candidate_roles` | array | 否 | 候选角色列表 ← `project_intakes.candidate_roles_json` |
| `candidate_constraints` | array | 否 | 候选约束列表 ← `project_intakes.candidate_constraints_json` |

必填项为 `initial_request`；真实 AI 调用只校验有效协议同意，不接受项目级或来源级数据处理策略（PRD §10、PD-003）；`created_by` 从认证身份取得，客户端不得指定。响应为 `202`：

```json
{
  "data": {
    "project_id": "PRJ_...",
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

创建项目命令立即返回 202，初始候选生成通过轮询 `GET /api/ai-jobs/:id` 获取（result 类型：`project_candidates`）。项目记录和 Owner 成员关系同事务创建，不等待 AI 结果。

**授权**：需有效登录账户和系统级 `create_project` 权限（真实 HTTP 试点默认授予所有有效账户；本地 demo 可通过受控 guest bridge 体验）；项目尚不存在，不能检查项目内 Owner 能力。事务成功后当前用户成为新项目 Owner。进入真实 AI 流程还需有效 `agreement_consents` 记录（未同意返回 `403 AGREEMENT_REQUIRED`，见 §2.2）。

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：initial_request。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**（通过 Job 结果返回，不在 202 响应中）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `data.project.id` | string | 项目 ID ← `projects.id` |
| `data.project.status` | string | 项目状态，初始为 `Draft` ← `projects.status` |
| `data.project.version` | integer | 乐观锁版本号 ← `projects.version` |
| `data.project.owner_id` | string | 项目所有者 ID ← `projects.owner_id` |
| `data.intake.id` | string | 建档记录 ID ← `project_intakes.id` |
| `data.intake.original_text` | string | 原始输入文本 ← `project_intakes.original_text` |
| `data.intake.version` | integer | 建档版本号 ← `project_intakes.intake_version` |
| `data.candidates` | array | 候选对象列表（仅 `candidate` 状态） |

候选只允许返回 `candidate` 状态，不得通过该命令创建正式 Stakeholder、As-Is、Constraint、Outcome、成功指标、失败条件或范围。创建项目、Owner 成员关系和 intake 必须同事务提交。

创建请求不接受 `source_upload_ids`：项目 ID 尚不存在时无法创建项目内 Source。客户端先创建草稿项目，再逐个调用项目上传端点；起始页选择的本地文件只作为待上传队列，项目创建失败时不得上传。

### 5.2 查询和修改

#### GET /api/projects/:id

返回项目概要、当前阶段、版本、阻断项和当前基线/报告引用。

**响应示例**：

```json
{
  "data": {
    "id": "PRJ_...",
    "name": "在线问诊系统",
    "description": "构建面向社区医院的在线问诊平台",
    "status": "Eliciting",
    "risk_level": "medium",
    "language": "zh-CN",
    "version": 8,
    "owner_id": "USR_...",
    "created_by": "USR_...",
    "current_domain_profile_id": "DP_...",
    "current_baseline": {
      "id": "BL_...",
      "baseline_version": 1,
      "status": "approved"
    },
    "current_report": null,
    "blockers": [
      {
        "type": "conflict",
        "id": "CF_...",
        "description": "数据隐私与实时监控存在冲突",
        "severity": "high"
      }
    ],
    "created_at": "2026-07-01T08:00:00Z",
    "updated_at": "2026-07-01T10:30:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 项目 ID ← `projects.id` |
| `name` | string\|null | 项目名称 ← `projects.name` |
| `description` | string\|null | 项目描述 ← `projects.description` |
| `status` | string | 项目阶段 ← `projects.status` |
| `risk_level` | string | 风险等级 ← `projects.risk_level` |
| `language` | string | 项目语言 ← `projects.language` |
| `version` | integer | 乐观锁版本 ← `projects.version` |
| `owner_id` | string | 所有者 ID ← `projects.owner_id` |
| `created_by` | string | 创建者 ID ← `projects.created_by` |
| `current_domain_profile_id` | string\|null | 当前已批准领域画像 ID ← `projects.current_domain_profile_id` |
| `current_baseline` | object\|null | 当前基线摘要：`id/baseline_version/status`（计算字段） |
| `current_report` | object\|null | 当前报告摘要：`id/report_version/status`（计算字段） |
| `blockers` | array | 当前阻断项摘要：`type/id/description/severity`（计算字段，来自未解决阻断冲突） |
| `created_at` | string | 创建时间（ISO 8601） ← `projects.created_at` |
| `updated_at` | string | 更新时间（ISO 8601） ← `projects.updated_at` |

#### PATCH /api/projects/:id

修改名称、语言和风险等级等项目属性，需 `expected_version` 和相应能力。项目和来源均不存在可配置的出站策略字段。

**请求示例**：

```json
{
  "name": "在线问诊系统 V2",
  "description": "扩展至三甲医院协作场景",
  "risk_level": "high",
  "language": "zh-CN",
  "expected_version": 8
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `name` | string\|null | 否 | 项目名称 ← `projects.name` |
| `description` | string\|null | 否 | 项目描述 ← `projects.description` |
| `risk_level` | string | 否 | 风险等级：`unknown` / `low` / `medium` / `high` ← `projects.risk_level` |
| `language` | string | 否 | 项目语言 ← `projects.language` |
| `expected_version` | integer | 是 | 乐观锁版本号，用于并发控制 |

**响应示例**：

```json
{
  "data": {
    "id": "PRJ_...",
    "name": "在线问诊系统 V2",
    "description": "扩展至三甲医院协作场景",
    "status": "Eliciting",
    "risk_level": "high",
    "language": "zh-CN",
    "version": 9,
    "updated_at": "2026-07-01T11:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**错误示例**：
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 项目 ID ← `projects.id` |
| `name` | string\|null | 项目名称 ← `projects.name` |
| `description` | string\|null | 项目描述 ← `projects.description` |
| `status` | string | 项目阶段 ← `projects.status` |
| `risk_level` | string | 风险等级 ← `projects.risk_level` |
| `language` | string | 项目语言 ← `projects.language` |
| `version` | integer | 更新后的乐观锁版本 ← `projects.version` |
| `updated_at` | string | 更新时间（ISO 8601） ← `projects.updated_at` |

#### DELETE /api/projects/:id

软删除正式项目（对齐 PRD §10.5、ADD §9.5、ADR-014）。创建 `delete_tasks` 记录（`scope=formal_project`），项目及其数据立即对普通用户和业务流程不可用，主存储在 30 天内物理清除；存在法律保留或合同义务时暂停物理清除并显示状态（`legal_hold=1`）。

**授权**：需 `Owner` 能力（只有项目所有者可以发起删除；见 §3 身份与能力表）。

**请求**：无请求体；需携带 `Idempotency-Key` 请求头。

**响应**（`202 Accepted`）：

```json
{
  "data": {
    "delete_task_id": "DT_...",
    "scope": "formal_project",
    "target_id": "PRJ_...",
    "status": "pending",
    "estimated_purge_at": "2026-08-01T00:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `delete_task_id` | string | 删除任务 ID ← `delete_tasks.id`（前缀 `DT_`） |
| `scope` | string | 删除范围，固定为 `formal_project` ← `delete_tasks.scope` |
| `target_id` | string | 目标项目 ID ← `delete_tasks.target_id` |
| `status` | string | 任务状态：`pending` / `in_progress` / `completed` / `failed` / `cancelled` ← `delete_tasks.status` |
| `estimated_purge_at` | string | 预计物理清除时间（ISO 8601），默认当前时间 + 30 天 |

**幂等**：需携带 `Idempotency-Key` 请求头。同幂等键重试返回首次响应（`202`），不创建第二个 `delete_tasks` 记录；不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。删除请求提交后立即生效，后续对该项目的查询返回 `404 RESOURCE_NOT_FOUND`。

**约束**（对齐 §14 数据库设计、ADD §9.5、PRD §10.5）：

- 删除请求提交后，数据必须立即对普通用户和业务流程不可用，主存储在 30 天内物理清除；
- 删除任务必须记录范围、申请人、时间、执行状态和失败原因，**不记录被删除正文**；`audit_ref` 仅记录审计引用；
- 删除不能破坏仍需保留的审计关系，必须先检查法律和合同义务；
- 发布快照依赖的材料和版本在保留期内不得被物理删除；
- 已发布报告的快照文件在保留期内随项目保留策略处理，存在法律保留时不得物理清除；
- 用户已经复制或下载到自己设备的文件无法由平台远程收回，界面必须提前说明。

**错误**：

- `404 RESOURCE_NOT_FOUND`：项目不存在或已不可见。
- `403 FORBIDDEN`：当前用户非 Owner，无权删除。
- `409 LEGAL_HOLD`：存在法律保留或合同义务，暂停物理删除。响应体携带 `legal_hold=true` 与原因。

```json
{
  "error": {
    "code": "LEGAL_HOLD",
    "message": "存在法律保留或合同义务，暂停物理删除。",
    "details": [
      { "legal_hold": true, "reason": "合同义务保留至 2027-01-01" }
    ],
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

#### GET /api/delete-tasks/:id

查询删除任务状态。发起删除的用户/游客、相关正式项目 Owner 或系统管理员可查询；其他主体统一返回 `404 RESOURCE_NOT_FOUND`，避免枚举任务。

**响应**（`200`）：

```json
{
  "data": {
    "delete_task_id": "DT_...",
    "scope": "formal_project",
    "target_id": "PRJ_...",
    "status": "in_progress",
    "legal_hold": false,
    "legal_hold_reason": null,
    "failure_reason": null,
    "created_at": "2026-07-02T00:00:00Z",
    "updated_at": "2026-07-02T00:05:00Z",
    "completed_at": null,
    "estimated_purge_at": "2026-08-01T00:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

当 `legal_hold=true` 时，`status` 保持 `pending` 或 `in_progress`，并返回面向用户的保留原因；失败时返回 `status=failed` 和不含业务正文的 `failure_reason`。查询删除任务不恢复目标资源的普通读取权限。

#### POST /api/projects/:id/intakes

追加修订后的原始输入，需 `supersedes_intake_id`，永不覆盖原记录。

**请求示例**：

```json
{
  "original_text": "补充说明：系统需支持多院区协同……",
  "decision_intent": "确认多院区部署方案",
  "selected_work_type": "healthcare-platform",
  "candidate_roles": [
    { "name": "院区管理员", "role": "coordinator" }
  ],
  "candidate_constraints": [
    { "type": "regulatory", "description": "需符合《医疗机构管理条例》" }
  ],
  "supersedes_intake_id": "INT_..."
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `original_text` | string | 是 | 修订后的原始需求描述 ← `project_intakes.original_text` |
| `decision_intent` | string\|null | 否 | 决策意图 ← `project_intakes.decision_intent` |
| `selected_work_type` | string\|null | 否 | 选定的工作类型 ← `project_intakes.selected_work_type` |
| `candidate_roles` | array | 否 | 候选角色 ← `project_intakes.candidate_roles_json` |
| `candidate_constraints` | array | 否 | 候选约束 ← `project_intakes.candidate_constraints_json` |
| `supersedes_intake_id` | string | 是 | 被替代的建档记录 ID ← `project_intakes.supersedes_intake_id` |

**响应示例**：

```json
{
  "data": {
    "id": "INT_...",
    "project_id": "PRJ_...",
    "intake_version": 2,
    "original_text": "补充说明：系统需支持多院区协同……",
    "decision_intent": "确认多院区部署方案",
    "selected_work_type": "healthcare-platform",
    "candidate_roles": [
      { "name": "院区管理员", "role": "coordinator" }
    ],
    "candidate_constraints": [
      { "type": "regulatory", "description": "需符合《医疗机构管理条例》" }
    ],
    "supersedes_intake_id": "INT_...",
    "content_hash": "sha256:...",
    "submitted_by": "USR_...",
    "created_at": "2026-07-01T11:30:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：original_text、supersedes_intake_id。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 建档记录 ID ← `project_intakes.id` |
| `project_id` | string | 所属项目 ID ← `project_intakes.project_id` |
| `intake_version` | integer | 建档版本号 ← `project_intakes.intake_version` |
| `original_text` | string | 原始文本 ← `project_intakes.original_text` |
| `decision_intent` | string\|null | 决策意图 ← `project_intakes.decision_intent` |
| `selected_work_type` | string\|null | 工作类型 ← `project_intakes.selected_work_type` |
| `candidate_roles` | array | 候选角色 ← `project_intakes.candidate_roles_json` |
| `candidate_constraints` | array | 候选约束 ← `project_intakes.candidate_constraints_json` |
| `supersedes_intake_id` | string\|null | 被替代的建档记录 ID ← `project_intakes.supersedes_intake_id` |
| `content_hash` | string | 内容哈希 ← `project_intakes.content_hash` |
| `submitted_by` | string | 提交者 ID ← `project_intakes.submitted_by` |
| `created_at` | string | 创建时间 ← `project_intakes.created_at` |

#### GET /api/projects/:id/members

返回项目成员列表。

**响应示例**：

```json
{
  "data": [
    {
      "user_id": "USR_001",
      "display_name": "张三",
      "email": "zhangsan@example.com",
      "capabilities": ["read", "edit", "review", "export", "manage_members"],
      "status": "active",
      "version": 1,
      "granted_by": "USR_001",
      "created_at": "2026-07-01T08:00:00Z",
      "updated_at": "2026-07-01T08:00:00Z"
    },
    {
      "user_id": "USR_002",
      "display_name": "李四",
      "email": "lisi@example.com",
      "capabilities": ["read", "edit", "export"],
      "status": "active",
      "version": 1,
      "granted_by": "USR_001",
      "created_at": "2026-07-01T09:00:00Z",
      "updated_at": "2026-07-01T09:00:00Z"
    }
  ],
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `user_id` | string | 用户 ID ← `project_members.user_id` |
| `display_name` | string | 用户显示名 ← `users.display_name`（关联查询） |
| `email` | string\|null | 邮箱 ← `users.email`（关联查询） |
| `capabilities` | array | 能力列表 ← `project_members.capabilities_json` |
| `status` | string | 成员状态：`active` / `revoked` ← `project_members.status` |
| `version` | integer | 成员记录版本 ← `project_members.version` |
| `granted_by` | string | 授权者 ID ← `project_members.granted_by` |
| `created_at` | string | 添加时间 ← `project_members.created_at` |
| `updated_at` | string | 更新时间 ← `project_members.updated_at` |

#### POST /api/projects/:id/members

Owner 添加成员。

**请求示例**：

```json
{
  "user_id": "USR_003",
  "capabilities": ["read", "review"]
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `user_id` | string | 是 | 被添加的用户 ID ← `project_members.user_id` |
| `capabilities` | array | 是 | 能力列表，至少包含 `read` ← `project_members.capabilities_json` |

**响应示例**：

```json
{
  "data": {
    "user_id": "USR_003",
    "display_name": "王五",
    "email": "wangwu@example.com",
    "capabilities": ["read", "review"],
    "status": "active",
    "version": 1,
    "granted_by": "USR_001",
    "created_at": "2026-07-01T12:00:00Z",
    "updated_at": "2026-07-01T12:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `管理成员` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：新增成员不携带 `expected_version`。同一项目中成员已存在时返回 `409 VERSION_CONFLICT` 或按相同 `Idempotency-Key` 返回首次创建结果；修改已有成员必须使用 PATCH 并携带 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：user_id、capabilities。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `user_id` | string | 用户 ID ← `project_members.user_id` |
| `display_name` | string | 用户显示名 ← `users.display_name` |
| `email` | string\|null | 邮箱 ← `users.email` |
| `capabilities` | array | 能力列表 ← `project_members.capabilities_json` |
| `status` | string | 成员状态 ← `project_members.status` |
| `version` | integer | 成员记录版本 ← `project_members.version` |
| `granted_by` | string | 授权者 ID ← `project_members.granted_by` |
| `created_at` | string | 添加时间 ← `project_members.created_at` |
| `updated_at` | string | 更新时间 ← `project_members.updated_at` |

#### PATCH /api/projects/:id/members/:userId

Owner 修改成员能力或撤销成员。

**请求示例**：

```json
{
  "capabilities": ["read", "edit", "review", "export"],
  "status": "active",
  "expected_version": 1
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `capabilities` | array | 否 | 更新后的能力列表 ← `project_members.capabilities_json` |
| `status` | string | 否 | 成员状态：`active` / `revoked` ← `project_members.status` |
| `expected_version` | integer | 是 | 乐观锁版本号（成员记录的版本） |

**响应示例**：

```json
{
  "data": {
    "user_id": "USR_003",
    "display_name": "王五",
    "capabilities": ["read", "edit", "review", "export"],
    "status": "active",
    "version": 2,
    "granted_by": "USR_001",
    "updated_at": "2026-07-01T12:30:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `管理成员` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**错误示例**：
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `user_id` | string | 用户 ID ← `project_members.user_id` |
| `display_name` | string | 用户显示名 ← `users.display_name` |
| `capabilities` | array | 更新后的能力列表 ← `project_members.capabilities_json` |
| `status` | string | 成员状态 ← `project_members.status` |
| `version` | integer | 更新后的成员记录版本 ← `project_members.version` |
| `granted_by` | string | 授权者 ID ← `project_members.granted_by` |
| `updated_at` | string | 更新时间 ← `project_members.updated_at` |

成员管理不得修改来源级内部安全限制；该限制只能由安全检测器按受控规则写入。

## 5A. 快速问诊会话与需求简报

快速问诊是默认主路径（P0），采用五步轻量步骤：输入想法 → 自适应追问 → 理解确认 → 方案与边界 → 生成版本化需求简报。步骤可以前后返回，不是严格瀑布（对齐 PRD §5、ADD §11.2、§12.1）。

状态机：`draft → clarifying → understanding_review → option_review → brief_ready → upgraded/archived`。快速问诊状态不得映射为正式项目状态或训练状态；"理解正确"不产生正式 ReviewAction。

### 5A.1 创建问诊会话

`POST /api/quick-sessions`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "original_input": "我想做一个 AI 海报生成网站",
  "intent": "clarify_idea",
  "decision_intent": null,
  "source_kind": "custom",
  "source_case_id": null
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `original_input` | string | 是 | 原始想法输入 ← `quick_sessions.original_input`；不可变 |
| `intent` | string\|null | 否 | 意图提示 |
| `decision_intent` | string\|null | 否 | 决策意图 |
| `source_kind` | string | 是 | `custom` / `sample` / `training_fixture` / `internal_test` ← `quick_sessions.source_kind` |
| `source_case_id` | string\|null | 否 | 示例、训练 Fixture 或内部测试案例 ID；当 `source_kind != custom` 时必填 |

**授权**：`actor_kind=guest`（凭 `session_key`）或 `actor_kind=user`；需有效协议同意记录（未同意返回 `403 AGREEMENT_REQUIRED`）。

**响应**（`201`）：

```json
{
  "data": {
    "id": "QS_...",
    "status": "draft",
    "original_input": "我想做一个 AI 海报生成网站",
    "source_kind": "custom",
    "coverage_slots": [],
    "current_understanding_version": 0,
    "created_at": "2026-07-01T08:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：

- 原始输入不可变；修订形成新版本，不覆盖原记录；
- 重复提交返回同一会话（同幂等键、同请求哈希）；不同请求体返回 `409 IDEMPOTENCY_CONFLICT`；
- 模型失败不丢原文，保留 `draft` 状态允许重试；
- 一句话输入只能产生候选，不得直接生成完整用户、场景、约束、预算、技术方案或验收结论。

**错误**：`AGREEMENT_REQUIRED`、`VALIDATION_ERROR`。

### 5A.2 获取会话状态

`GET /api/quick-sessions/:id`：返回当前状态、覆盖槽位和当前理解版本。

**响应**（`200`）：

```json
{
  "data": {
    "id": "QS_...",
    "status": "clarifying",
    "original_input": "我想做一个 AI 海报生成网站",
    "source_kind": "custom",
    "coverage_slots": [
      { "slot_id": "expected_outcome", "status": "covered", "last_updated": "2026-07-01T08:05:00Z" },
      { "slot_id": "user_object", "status": "partial", "last_updated": "2026-07-01T08:06:00Z" }
    ],
    "current_understanding_version": 2,
    "current_brief_version": null,
    "created_at": "2026-07-01T08:00:00Z",
    "updated_at": "2026-07-01T08:10:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

### 5A.3 自适应追问/回答

`POST /api/quick-sessions/:id/messages`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "action": "answer",
  "content": "主要面向设计师和小团队",
  "question_id": "Q_005"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | `answer` / `skip` / `unknown` |
| `content` | string\|null | 否 | 回答内容；`skip` 时可空 |
| `question_id` | string\|null | 否 | 对应问题 ID |

**授权**：`actor_kind=guest` 或 `actor_kind=user`；触发真实 AI 追问需有效协议同意（未同意返回 `403 AGREEMENT_REQUIRED`）。

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

追问结果通过轮询 `GET /api/ai-jobs/:id` 获取（result 类型：`next_question`）。原始响应字段（通过 Job 结果返回，不在 202 响应中）：`next_question`（`question_id`、`text`、`topic`）、`coverage_slots`、`is_blocking_unknown`。

**约束**：

- 问题根据已有答案动态选择，优先澄清高价值缺口；一次优先询问一个主题；
- 与旧目标冲突时进入理解修订，不静默覆盖；
- 阻断未知不能生成确定性推荐，只能输出带醒目风险的未完成草稿；
- 对回答摘要时区分"用户明确说过"和"系统推测"；
- 问题数量由信息缺口决定，不以固定轮数作为真实完成条件。

### 5A.4 获取覆盖槽位状态

`GET /api/quick-sessions/:id/coverage`：返回六类覆盖槽位状态。

**响应**（`200`）：

```json
{
  "data": {
    "slots": [
      { "slot_id": "expected_outcome", "status": "covered", "last_updated": "2026-07-01T08:05:00Z" },
      { "slot_id": "user_object", "status": "covered", "last_updated": "2026-07-01T08:06:00Z" },
      { "slot_id": "core_scenario", "status": "partial", "last_updated": "2026-07-01T08:07:00Z" },
      { "slot_id": "scope_boundary", "status": "not_started", "last_updated": null },
      { "slot_id": "completion_criteria", "status": "not_started", "last_updated": null },
      { "slot_id": "constraints_risks", "status": "not_started", "last_updated": null }
    ]
  },
  "meta": { "request_id": "REQ_..." }
}
```

六类槽位（`CoverageSlot`）：`expected_outcome`（期望结果）、`user_object`（用户/相关对象）、`core_scenario`（核心场景）、`scope_boundary`（范围边界）、`completion_criteria`（完成判断）、`constraints_risks`（约束与风险）。进度不得显示虚假的完成百分比，也不得把"回答了第几题"当成需求完整度。

### 5A.4a 获取问诊消息与当前问题

`GET /api/quick-sessions/:id/messages`：返回快速问诊消息历史和当前待回答问题。无需 `Idempotency-Key`。

**响应**（`200`）：

```json
{
  "data": {
    "items": [
      {
        "id": "QT_001",
        "turn_index": 0,
        "role": "ai",
        "content": "这个网站主要想帮谁解决什么问题？",
        "question_id": "Q_001",
        "understanding_version": null,
        "created_at": "2026-07-01T08:01:00Z"
      },
      {
        "id": "QT_002",
        "turn_index": 1,
        "role": "user",
        "content": "主要面向设计师和小团队。",
        "question_id": "Q_001",
        "understanding_version": 1,
        "created_at": "2026-07-01T08:02:00Z"
      }
    ],
    "current_question": {
      "question_id": "Q_002",
      "text": "第一版必须完成哪些输出？",
      "topic": "scope_boundary",
      "blocking": true
    }
  },
  "meta": { "request_id": "REQ_...", "cursor": null, "has_more": false }
}
```

**约束**：

- 该端点只读，不触发真实 AI；
- 页面刷新、返回问诊页或跨设备恢复时必须通过该端点恢复消息和当前问题，不得重新发送 `POST /messages` 来“重建”问题；
- `current_question=null` 表示当前没有待回答问题，前端根据会话状态显示生成简报、继续补充或等待 Job 的入口。

### 5A.4b 获取当前理解

`GET /api/quick-sessions/:id/understanding`：按 `current_understanding_version` 返回当前理解正文。无需 `Idempotency-Key`。

**响应**（`200`）：

```json
{
  "data": {
    "understanding_version": 2,
    "summary": "用户希望搭建一个 AI 海报生成网站，面向设计师与小团队……",
    "updated_at": "2026-07-01T08:10:00Z",
    "updated_by": "JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

`summary` 对应 `understanding_updated` Job 结果中的理解摘要正文；尚未生成任何理解版本时为 `null`。`updated_by` 为产出该版本理解的 Job ID 或操作人。该端点用于页面刷新后重新取回右栏"当前理解"内容，不触发真实 AI；`understanding_version` 与 §5A.2 返回的 `current_understanding_version` 一致。

**错误**：`RESOURCE_NOT_FOUND`（`404`，会话不存在）。

### 5A.4c 获取未知项列表

`GET /api/quick-sessions/:id/unknowns`：返回未知项详情列表（对应 `quick_unknowns` 表）。无需 `Idempotency-Key`。

**查询参数**：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `status` | string | 否 | `blocking` / `non_blocking`；按阻断性筛选，不传返回全部 |

**响应**（`200`）：

```json
{
  "data": {
    "items": [
      {
        "id": "QU_...",
        "question": "目标用户是否包含非设计师的普通用户？",
        "impact": "影响范围边界与完成条件的判定",
        "is_blocking": true,
        "suggested_responsible": "产品负责人",
        "suggested_info_needed": "目标用户画像",
        "review_condition": "范围边界槽位覆盖后再复查",
        "created_at": "2026-07-01T08:08:00Z",
        "resolved_at": null,
        "status": "open"
      }
    ]
  },
  "meta": { "request_id": "REQ_...", "cursor": null, "has_more": false }
}
```

未知项来自 §5A.3 追问与 `understanding_updated` Job 的产出（对齐 ADD Fixture `unknowns.json`）；`is_blocking=true` 的未知只能生成醒目标记的未完成草稿，不能生成完整简报或确定性推荐（对齐 PRD-UNKNOWN-001）。该端点用于页面刷新后重新取回右栏"未知项"列表，不触发真实 AI。

**错误**：`RESOURCE_NOT_FOUND`（`404`，会话不存在）、`VALIDATION_ERROR`（`status` 不合法）。

### 5A.5 理解确认

`POST /api/quick-sessions/:id/understanding-review`，需 `Idempotency-Key`。

**授权**：当前快速会话所有用户；游客须持有所属凭证。该命令会触发真实 AI，需有效协议同意，否则返回 `403 AGREEMENT_REQUIRED`。

**请求示例**：

```json
{
  "action": "correct"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | `correct` / `modify` / `uncertain` / `return` |

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

理解更新结果通过轮询获取（result 类型：`understanding_updated`）。原始响应字段（通过 Job 结果返回，不在 202 响应中）：`new_understanding_version`、`next_step`。

**约束**：

- 不产生正式 `ReviewAction`；"理解正确"只表示当前摘要符合用户表达，不等于正式审批、已接受需求或需求基线；
- `modify` 生成新理解版本，重算覆盖和受影响方案；空修改提示具体字段，不覆盖旧版本；
- `uncertain` 保留未知并继续，但输出中必须显著标记其影响；
- `return` 回到相关问题，不要求重新开始。

### 5A.6 主题变化处理

`POST /api/quick-sessions/:id/topic-change`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "action": "append"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | `append`（补充当前想法）/ `new_session`（创建新会话）/ `defer`（暂缓分类） |

**响应**（`200`）：

```json
{
  "data": {
    "new_session_id": null
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：选择 `append` 时记录其影响并重新评估覆盖槽位；选择 `new_session` 时创建独立问诊会话，不复制当前简报结论；无选择时不合并输入。

### 5A.7 记录方案偏好

`POST /api/quick-sessions/:id/option-preferences`，需 `Idempotency-Key`。

**授权**：当前快速会话所有用户；游客须持有所属凭证。该命令会触发真实 AI 方案比较，需有效协议同意，否则返回 `403 AGREEMENT_REQUIRED`。

**请求示例**：

```json
{
  "option_id": "OPT_002",
  "matches_ai_recommendation": false
}
```

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

方案比较结果通过轮询获取（result 类型：`option_comparison`）。原始响应字段（通过 Job 结果返回，不在 202 响应中）：`preference_id`。

**约束**：记录为"用户当前偏好"，保留 AI 建议和其他方案的取舍；不生成正式 `Decision`；AI 不得反复阻止用户，也不得把"当前偏好"写成已经获得正式批准的 Decision；高风险偏好显示阻断。

### 5A.8 生成需求简报

`POST /api/quick-sessions/:id/briefs`，需 `Idempotency-Key`。

**授权**：当前快速会话所有用户；游客须持有所属凭证。该命令会触发真实 AI 简报生成，需有效协议同意，否则返回 `403 AGREEMENT_REQUIRED`。

**请求示例**：

```json
{
  "accept_incomplete": false
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `accept_incomplete` | boolean | 否 | 是否接受未完成草稿，默认 `false` |

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

简报版本通过轮询获取（result 类型：`brief_version`）。原始响应字段（通过 Job 结果返回，不在 202 响应中）：`brief_version`、`is_incomplete`、`blocking_unknown_count`。

**约束**：

- 最低覆盖满足或用户接受未完成草稿时可生成；
- 阻断未知存在时只能生成醒目标记的未完成草稿，不给出确定性推荐；
- 每次生成形成新的 `brief_version`，不覆盖旧版本；
- `brief_ready` 不是不可逆的"完成"终点，用户可以继续补充并产生新版本。

**错误**：`COVERAGE_INSUFFICIENT`（`409`，覆盖不足且未接受未完成草稿）。

### 5A.9 获取指定版本简报

`GET /api/quick-sessions/:id/briefs/:version`：返回简报快照。

**响应**（`200`）：

```json
{
  "data": {
    "brief_version": 1,
    "snapshot": {
      "original_input": "我想做一个 AI 海报生成网站",
      "expected_outcome": "...",
      "target_users": ["设计师", "小团队"],
      "core_scenario": "...",
      "scope_included": ["..."],
      "scope_excluded": ["..."],
      "core_requirements": [],
      "completion_criteria": [],
      "candidate_options": [],
      "constraints_risks": [],
      "unknowns": [],
      "recommended_next_step": "..."
    },
    "generated_at": "2026-07-01T08:30:00Z",
    "is_incomplete": false
  },
  "meta": { "request_id": "REQ_..." }
}
```

简报内容契约（对齐 PRD §5.6）：用户原始想法、当前希望取得的结果、目标用户/相关角色和使用场景、本次范围与明确不做、核心需求和优先顺序、可观察的完成条件、候选方案与取舍、约束/风险/假设和待确认问题、建议下一步、可复制的沟通版本和完整详细报告正文。缺失内容必须显示为"待确认 / 尚未提供 / 不适用"，不得自动补成事实。

**错误**：`BRIEF_VERSION_NOT_FOUND`（`404`）。

### 5A.9a 获取简报版本列表

`GET /api/quick-sessions/:id/briefs`：返回指定快速会话的简报版本历史。无需 `Idempotency-Key`。

**响应**（`200`）：

```json
{
  "data": [
    {
      "brief_version": 2,
      "generated_at": "2026-07-01T08:45:00Z",
      "is_incomplete": false,
      "blocking_unknown_count": 0
    },
    {
      "brief_version": 1,
      "generated_at": "2026-07-01T08:30:00Z",
      "is_incomplete": true,
      "blocking_unknown_count": 1
    }
  ],
  "meta": { "request_id": "REQ_...", "cursor": null, "has_more": false }
}
```

版本列表只返回摘要；具体内容仍通过 `GET /api/quick-sessions/:id/briefs/:version` 读取。前端不得用浏览器内已知版本替代服务端版本列表。

### 5A.10 获取投影视图

`GET /api/quick-sessions/:id/briefs/:version/views/:viewType`：

- `viewType`：`simple`（概述）/ `exec`（详细报告）。

**响应**（`200`）：

```json
{
  "data": {
    "view_type": "exec",
    "rendered_content": "...",
    "brief_version": 1
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：两个视图从同一 `brief_version` 投影，不单独生成新事实、需求或决策；不同视图可以改变篇幅、顺序和用词，不能改变事实、范围、未知、方案选择和完成条件。

**错误**：`BRIEF_VERSION_NOT_FOUND`（`404`）、`VALIDATION_ERROR`（`viewType` 不合法）。

### 5A.11 复制/下载简报

`POST /api/quick-sessions/:id/briefs/:version/exports`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "view_type": "exec",
  "export_type": "download"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `view_type` | string | 是 | `simple` / `exec` |
| `export_type` | string | 是 | `copy` / `download` |

**响应**（`201`）：

```json
{
  "data": {
    "export_id": "BEX_...",
    "expires_at": "2026-07-02T08:30:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：导出物显示简报版本、生成时间、仍存在的阻断/非阻断未知及"非正式项目基线"说明；用户继续补充后形成新版本，旧导出物不被静默改写；首期导出不产生公开访问面。

#### GET /api/quick-sessions/:id/briefs/:version/download

下载指定版本的简报导出文件。与 `POST .../exports` 配合使用：POST 创建一次性签名导出（返回 `export_id` 与 `expires_at`），本端点用于实际下载文件流；也可在未显式调用 POST 时直接触发下载，由服务端内部完成导出并返回。

**授权**：`actor_kind=guest`（凭 `session_key`）或 `actor_kind=user`；游客只能下载自己会话的简报。

**查询参数**（可选）：

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `view_type` | string | 否 | `simple` / `exec`，默认 `exec` |
| `export_id` | string | 否 | 已通过 POST 创建的 `export_id`；携带时复用既有签名导出，不携带时内部生成 |

**响应**（`302 Found`）：重定向到临时下载 URL（24 小时有效，与 §14.2 服务端临时导出文件默认期一致），响应头携带 `Location: <临时签名 URL>`；或 `200 OK` 直接返回导出文件二进制流（`Content-Type: text/markdown; charset=utf-8` 或 `application/pdf`，由实现与 `view_type` 决定），`Content-Disposition: attachment; filename="brief-{version}-{view_type}.md"`。

**约束**：

- 导出物显示简报版本、生成时间、仍存在的阻断/非阻断未知及"非正式项目基线"说明（与 POST 端点一致）；
- 临时下载 URL 24 小时后失效；用户继续补充形成新版本后，旧导出物不被静默改写；
- 首期导出不产生公开访问面，不返回可被外部直接访问的公开链接。

**错误**：

- `404 RESOURCE_NOT_FOUND`：会话或简报版本不存在。
- `403 FORBIDDEN`：当前游客/用户非该会话归属人。
- `410 GONE`：携带的 `export_id` 已过期或被回收。

### 5A.12 简报可用性反馈

`POST /api/quick-sessions/:id/briefs/:version/usefulness-feedback`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "rating": "usable_with_minor_or_no_edits",
  "expected_use": "交给开发团队"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `rating` | string | 是 | `usable_with_minor_or_no_edits` / `needs_major_revision` / `not_usable` |
| `expected_use` | string\|null | 否 | 预期用途 |

**响应**（`201`）：

```json
{
  "data": {
    "feedback_id": "BUF_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：不收集自由文本；`brief_exported` 不能代表真正使用。

### 5A.13 放弃会话

`POST /api/quick-sessions/:id/abandon`，需 `Idempotency-Key`。

**响应**（`200`）：

```json
{
  "data": {
    "id": "QS_...",
    "status": "archived",
    "abandoned_at": "2026-07-01T12:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：满足放弃判定且尚无简报/升级时可放弃；不等于删除，用户删除会话时按保留策略处理。

### 5A.14 归档会话

`POST /api/quick-sessions/:id/archive`，需 `Idempotency-Key`。

**响应**（`200`）：

```json
{
  "data": {
    "id": "QS_...",
    "status": "archived",
    "archived_at": "2026-07-01T12:05:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：不存在运行中的升级命令时可归档；归档不等于删除，仍可按权限查看；恢复策略由实现阶段定义。

### 5A.15 升级正式项目

`POST /api/quick-sessions/:id/upgrade`，需 `Idempotency-Key`（ADR-022）。

**请求示例**：

```json
{
  "brief_version": 1,
  "expected_quick_session_version": 3
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `brief_version` | integer | 是 | 升级所基于的简报版本 ← `upgrade_records.brief_version` |
| `expected_quick_session_version` | integer | 是 | 快速会话乐观锁版本号，用于并发控制 |

**授权**：需 `actor_kind=user` 认证（游客不能创建正式项目）；需有效协议同意记录。

**响应**（`201`）：

```json
{
  "data": {
    "project_id": "PRJ_...",
    "upgrade_record_id": "UPG_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**（对齐 ADD §11.5、PRD §8.4）：

- 原子创建正式 `projects` + Owner 成员 + `intake`（`source_quick_session_id`）+ 复制候选 + `upgrade_records`；
- 任一步失败完全回滚，保持 `brief_ready`，不产生半成品项目、重复候选或错误 `upgraded` 状态；
- 同幂等键重试返回首次成功结果，不创建第二个项目；
- 升级映射：原始输入 → 不可变 `project_intake`；用户明确回答 → 带问答来源的候选陈述；AI 当前理解 → `Inference`/`Proposal`；阻断/非阻断未知 → `Unknown`；需求条目 → Candidate Requirement；方案比较 → Candidate Decision Options；用户偏好 → 偏好记录（非正式 Decision）；完成条件 → Candidate Acceptance Criteria；需求简报 → 项目初始工作材料（非已发布报告）；"理解正确"记录 → 来源审计（非正式 ReviewAction）；
- 升级成功后，快速问诊与正式项目通过只读来源关系关联，二者后续版本分别演化；
- 若创建后发现业务错误，只能归档/纠正正式项目并保留审计，不能删除升级来源关系后伪装未发生。

**错误**：

- `VERSION_CONFLICT`（`409`）：`expected_quick_session_version` 不一致；
- `AGREEMENT_REQUIRED`（`403`）：未同意有效协议；
- `UPGRADE_FAILED`（`409`）：升级操作失败。

### 5A.16 软删除会话

`DELETE /api/quick-sessions/:id`，需 `Idempotency-Key`（对齐 PRD §10.5、ADD §9.5）。

软删除快速问诊会话，与 §5A.13 放弃、§5A.14 归档不同：放弃/归档仅切换状态，删除创建 `delete_tasks` 记录（`scope=quick_session`），会话及其简报/导出立即对用户不可用，主存储在 30 天内物理清除。

**授权**：`actor_kind=guest`（凭 `session_key` 认证）或 `actor_kind=user`；游客只能删除自己创建的会话（由 `quick_sessions.guest_session_id` 与当前会话凭证匹配校验），用户只能删除归属自己的会话。

**请求**：无请求体；需携带 `Idempotency-Key` 请求头。

**响应**（`202 Accepted`）：

```json
{
  "data": {
    "delete_task_id": "DT_...",
    "scope": "quick_session",
    "target_id": "QS_...",
    "status": "pending",
    "estimated_purge_at": "2026-08-01T00:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `delete_task_id` | string | 删除任务 ID ← `delete_tasks.id`（前缀 `DT_`） |
| `scope` | string | 删除范围，固定为 `quick_session` ← `delete_tasks.scope` |
| `target_id` | string | 目标快速问诊会话 ID ← `delete_tasks.target_id` |
| `status` | string | 任务状态：`pending` / `in_progress` / `completed` / `failed` / `cancelled` ← `delete_tasks.status` |
| `estimated_purge_at` | string | 预计物理清除时间（ISO 8601），默认当前时间 + 30 天 |

**幂等**：需携带 `Idempotency-Key` 请求头。同幂等键重试返回首次响应（`202`），不创建第二个 `delete_tasks` 记录；不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。删除请求提交后立即生效，后续对该会话的查询返回 `404 RESOURCE_NOT_FOUND`。

**约束**（对齐 §14 数据库设计、ADD §9.5、PRD §10.5）：

- 游客删除时通过 `session_key` 认证，不要求先登录；
- 快速会话已升级为正式项目时，系统只删除允许删除的快速侧副本；正式项目中依法或依合同必须保留的来源快照继续保留并显示原因；
- 删除任务必须记录范围、申请人、时间、执行状态和失败原因，**不记录被删除正文**；`audit_ref` 仅记录审计引用；
- 删除不能破坏仍需保留的审计关系，必须先检查法律和合同义务；
- 已生成的简报导出物在 `brief_exports.expires_at` 后随会话删除一并处理，不超过服务端临时导出文件 24 小时默认期；
- 用户已经复制或下载到自己设备的简报内容无法由平台远程收回，界面必须提前说明。

**错误**：

- `404 RESOURCE_NOT_FOUND`：会话不存在或已不可见。
- `403 FORBIDDEN`：当前游客/用户非该会话归属人，无权删除。
- `409 LEGAL_HOLD`：存在法律保留或合同义务，暂停物理删除。响应体携带 `legal_hold=true` 与原因（与 `DELETE /api/projects/:id` 一致）。
- `409 IDEMPOTENCY_CONFLICT`：同幂等键不同请求体。

## 6. 领域画像与静态领域配置

### 6.1 生成领域画像候选

`POST /api/projects/:id/analysis-runs` 且 `task=domain_profile`：生成领域画像候选；不再提供职责重复的 `/domain-profile/candidates`。

**请求示例**：

```json
{
  "task": "domain_profile",
  "source_ids": ["SRC_001", "SRC_002"],
  "expected_project_version": 8
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `task` | string | 是 | 固定值 `domain_profile` ← `ai_jobs.task_type` |
| `source_ids` | array | 否 | 用于分析的来源 ID 列表 ← 关联 `sources.id` |
| `expected_project_version` | integer | 是 | 项目版本号，用于并发控制 |

**响应示例**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `job_id` | string | 异步作业 ID ← `ai_jobs.id` |
| `run_id` | string | 本次运行 ID ← `ai_runs.id` |
| `task` | string | 任务类型 ← `ai_jobs.task_type` |
| `status` | string | 作业状态 ← `ai_jobs.status` |
| `created_at` | string | 创建时间 ← `ai_jobs.created_at` |

### 6.2 查询当前领域画像

`GET /api/projects/:id/domain-profile`：返回当前候选/已批准画像及版本。

**响应示例**：

```json
{
  "data": {
    "id": "DP_...",
    "project_id": "PRJ_...",
    "profile_version": 2,
    "work_type": "healthcare-platform",
    "domain_labels": ["医疗", "在线问诊", "多院区"],
    "risk_flags": ["数据隐私", "合规"],
    "terminology_map": {
      "患者": "patient",
      "医生": "physician",
      "院区": "campus"
    },
    "suggested_pack_ids": ["software-delivery", "general"],
    "required_human_roles": ["医疗合规专家", "院区运营负责人"],
    "routing_risk": "medium",
    "routing_basis": {
      "complexity": "high",
      "stakeholder_count": 15
    },
    "rationale_evidence_links": ["EVL_001", "EVL_002"],
    "unknowns": [
      { "question": "跨院区数据同步延迟要求？", "status": "open" }
    ],
    "status": "approved",
    "classifier_model": "domain-classifier-v2",
    "prompt_version": "dp-prompt-v3",
    "approved_by": "USR_001",
    "approved_at": "2026-07-01T10:00:00Z",
    "supersedes_profile_id": "DP_OLD",
    "created_at": "2026-07-01T09:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 画像 ID ← `domain_profiles.id` |
| `project_id` | string | 所属项目 ID ← `domain_profiles.project_id` |
| `profile_version` | integer | 画像版本号 ← `domain_profiles.profile_version` |
| `work_type` | string | 工作类型 ← `domain_profiles.work_type` |
| `domain_labels` | array | 领域标签 ← `domain_profiles.domain_labels_json` |
| `risk_flags` | array | 风险标记 ← `domain_profiles.risk_flags_json` |
| `terminology_map` | object | 术语映射 ← `domain_profiles.terminology_map_json` |
| `suggested_pack_ids` | array | 建议的领域包 ID ← `domain_profiles.suggested_pack_ids_json` |
| `required_human_roles` | array | 需要的人工角色 ← `domain_profiles.required_human_roles_json` |
| `routing_risk` | string | 路由风险等级 ← `domain_profiles.routing_risk` |
| `routing_basis` | object | 路由依据 ← `domain_profiles.routing_basis_json` |
| `rationale_evidence_links` | array | 论证证据链接 ← `domain_profiles.rationale_evidence_links_json` |
| `unknowns` | array | 未知项 ← `domain_profiles.unknowns_json` |
| `status` | string | 画像状态 ← `domain_profiles.status` |
| `classifier_model` | string\|null | 分类模型名 ← `domain_profiles.classifier_model` |
| `prompt_version` | string\|null | Prompt 版本 ← `domain_profiles.prompt_version` |
| `approved_by` | string\|null | 批准者 ID ← `domain_profiles.approved_by` |
| `approved_at` | string\|null | 批准时间 ← `domain_profiles.approved_at` |
| `supersedes_profile_id` | string\|null | 被替代的画像 ID ← `domain_profiles.supersedes_profile_id` |
| `created_at` | string | 创建时间 ← `domain_profiles.created_at` |

### 6.3 评审领域画像

`POST /api/projects/:id/domain-profile/reviews`：Reviewer/Owner 执行 `accept | modify | reject | uncertain`，需对象版本。

**请求示例**：

```json
{
  "action": "accept",
  "entity_version": 2,
  "reason": "领域标签和风险标记覆盖了当前业务场景"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | 评审动作：`accept` / `modify` / `reject` / `uncertain` ← `review_actions.action` |
| `entity_version` | integer | 是 | 被评审的画像版本号 ← `review_actions.entity_version` |
| `reason` | string | 是 | 评审理由 ← `review_actions.reason` |
| `after_value` | object | 否 | 当 `action=modify` 时，修改后的值 ← `review_actions.after_value` |
| `follow_up` | object | 否 | 当 `action=uncertain` 时，跟进信息 ← `review_actions.follow_up_json` |

**响应示例**：

```json
{
  "data": {
    "id": "RV_...",
    "gate": "domain_profile",
    "entity_type": "domain_profile",
    "entity_id": "DP_...",
    "entity_version": 2,
    "action": "accept",
    "reviewer_id": "USR_001",
    "reason": "领域标签和风险标记覆盖了当前业务场景",
    "created_at": "2026-07-01T14:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `执行人工关口` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "当前用户无权评审领域画像。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 评审记录 ID ← `review_actions.id` |
| `gate` | string\|null | 关口类型 ← `review_actions.gate` |
| `entity_type` | string | 实体类型 ← `review_actions.entity_type` |
| `entity_id` | string | 实体 ID ← `review_actions.entity_id` |
| `entity_version` | integer | 实体版本 ← `review_actions.entity_version` |
| `action` | string | 评审动作 ← `review_actions.action` |
| `reviewer_id` | string | 评审者 ID ← `review_actions.reviewer_id` |
| `reason` | string | 评审理由 ← `review_actions.reason` |
| `created_at` | string | 创建时间 ← `review_actions.created_at` |

### 6.4 列出领域包

`GET /api/domain-packs`：v1 只列出内置 `general` 和静态 `software-delivery` 配置。

**响应示例**：

```json
{
  "data": [
    {
      "id": "general",
      "name": "通用领域配置",
      "latest_version": "1.0.0",
      "status": "released",
      "compatible_core_schema": "1.0.0",
      "released_at": "2026-06-01T00:00:00Z"
    },
    {
      "id": "software-delivery",
      "name": "软件交付领域配置",
      "latest_version": "1.0.0",
      "status": "released",
      "compatible_core_schema": "1.0.0",
      "released_at": "2026-06-01T00:00:00Z"
    }
  ],
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 领域包 ID ← `domain_packs.id` |
| `name` | string | 名称 ← `domain_packs.name` |
| `latest_version` | string | 最新版本号 ← `domain_packs.version`（聚合） |
| `status` | string | 状态：`released` / `deprecated` ← `domain_packs.status` |
| `compatible_core_schema` | string | 兼容的核心 Schema 版本 ← `domain_packs.compatible_core_schema` |
| `released_at` | string | 发布时间 ← `domain_packs.released_at` |

### 6.5 获取领域包版本详情

`GET /api/domain-packs/:id/versions/:version`：返回 manifest、适用条件和版本状态。

**响应示例**：

```json
{
  "data": {
    "id": "software-delivery",
    "version": "1.0.0",
    "name": "软件交付领域配置",
    "status": "released",
    "compatible_core_schema": "1.0.0",
    "manifest": {
      "entity_types": ["requirement", "outcome", "driver"],
      "custom_fields": [
        { "name": "story_points", "type": "integer", "entity": "requirement" }
      ],
      "gates": ["definition_of_ready", "definition_of_done"]
    },
    "manifest_hash": "sha256:...",
    "released_at": "2026-06-01T00:00:00Z",
    "deprecated_at": null
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 领域包 ID ← `domain_packs.id` |
| `version` | string | 版本号 ← `domain_packs.version` |
| `name` | string | 名称 ← `domain_packs.name` |
| `status` | string | 状态 ← `domain_packs.status` |
| `compatible_core_schema` | string | 兼容的核心 Schema ← `domain_packs.compatible_core_schema` |
| `manifest` | object | 领域包清单 ← `domain_packs.manifest_json` |
| `manifest_hash` | string | 清单哈希 ← `domain_packs.manifest_hash` |
| `released_at` | string | 发布时间 ← `domain_packs.released_at` |
| `deprecated_at` | string\|null | 弃用时间 ← `domain_packs.deprecated_at` |

版本不存在时返回 `404 RESOURCE_NOT_FOUND`，详见 §4.1。

### 6.6 激活领域包

`POST /api/projects/:id/domain-packs/:packId/activations`：人工激活指定版本。

**请求示例**：

```json
{
  "domain_pack_version": "software-delivery@1.0.0",
  "domain_profile_id": "DP_...",
  "activation_reason": "当前项目属于软件交付领域，需要相应的需求模板和关口定义"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `domain_pack_version` | string | 是 | 领域包版本标识，格式 `{pack_id}@{version}` ← `project_domain_packs.domain_pack_id` + `domain_pack_version` |
| `domain_profile_id` | string | 是 | 关联的领域画像 ID ← `project_domain_packs.domain_profile_id` |
| `activation_reason` | string | 是 | 激活理由 ← `project_domain_packs.activation_reason` |

**响应示例**：

```json
{
  "data": {
    "id": "PDP_...",
    "project_id": "PRJ_...",
    "domain_pack_id": "software-delivery",
    "domain_pack_version": "1.0.0",
    "domain_profile_id": "DP_...",
    "activation_reason": "当前项目属于软件交付领域，需要相应的需求模板和关口定义",
    "status": "active",
    "activated_by": "USR_001",
    "activated_at": "2026-07-01T14:30:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：domain_pack_version、domain_profile_id、activation_reason。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 激活记录 ID ← `project_domain_packs.id` |
| `project_id` | string | 项目 ID ← `project_domain_packs.project_id` |
| `domain_pack_id` | string | 领域包 ID ← `project_domain_packs.domain_pack_id` |
| `domain_pack_version` | string | 版本号 ← `project_domain_packs.domain_pack_version` |
| `domain_profile_id` | string | 关联画像 ID ← `project_domain_packs.domain_profile_id` |
| `activation_reason` | string | 激活理由 ← `project_domain_packs.activation_reason` |
| `status` | string | 激活状态 ← `project_domain_packs.status` |
| `activated_by` | string | 激活者 ID ← `project_domain_packs.activated_by` |
| `activated_at` | string | 激活时间 ← `project_domain_packs.activated_at` |

同一项目同一配置同时最多一个 `active` 版本。若已存在 `active` 版本，需先停用旧版本后再激活新版本。

- `POST /api/projects/:id/domain-packs/:packId/deactivation-previews`：只计算停用影响，不修改激活状态；
- `POST /api/projects/:id/domain-packs/:packId/deactivations`：携带已确认的 `preview_id` 和 `expected_version` 执行停用；已使用版本仍保留历史引用。

AI 不能直接批准 DomainProfile、创建正式专业包或激活专业包。

画像状态统一为 `candidate → under_review → approved | rejected`，已批准旧版本被替代后为 `superseded`。`uncertain` 保持或回到 `candidate` 并创建待核实项，不使用含义不明确的 `reviewed` 稳定状态。

## 7. 来源、证据与调用安全

### 7.1 上传来源

`POST /api/projects/:id/sources` 使用 `multipart/form-data`。

**请求示例**（multipart 描述）：

```
POST /api/projects/PRJ_.../sources
Content-Type: multipart/form-data; boundary=----Boundary

------Boundary
Content-Disposition: form-data; name="file"; filename="需求访谈记录.pdf"
Content-Type: application/pdf

<binary content>
------Boundary
Content-Disposition: form-data; name="metadata"

{
  "source_type": "document",
  "author": "张三",
  "captured_at": "2026-06-28T10:00:00Z",
  "sensitivity": "confidential"
}
------Boundary--
```

**元数据字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `source_type` | string | 是 | 来源类型：`document` / `transcript` / `meeting_notes` 等 ← `sources.source_type` |
| `author` | string\|null | 否 | 作者 ← `sources.author` |
| `captured_at` | string\|null | 否 | 采集时间（ISO 8601） ← `sources.captured_at` |
| `sensitivity` | string | 是 | 敏感度：`public` / `internal` / `confidential` / `restricted` ← `sources.sensitivity` |

服务端保存不可变原件、计算哈希并创建解析 Job。重复内容可去重存储，但必须保留独立来源记录。

**响应示例**：

```json
{
  "data": {
    "id": "SRC_...",
    "project_id": "PRJ_...",
    "file_name": "需求访谈记录.pdf",
    "media_type": "application/pdf",
    "source_type": "document",
    "author": "张三",
    "captured_at": "2026-06-28T10:00:00Z",
    "sensitivity": "confidential",
    "extraction_status": "queued",
    "blob_id": "BLB_...",
    "byte_size": 2457600,
    "sha256": "sha256:...",
    "created_by": "USR_001",
    "created_at": "2026-07-01T15:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "不支持的文件类型。允许：PDF、DOCX、TXT、MD、CSV、PNG、JPEG。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 来源 ID ← `sources.id` |
| `project_id` | string | 所属项目 ID ← `sources.project_id` |
| `file_name` | string | 文件名 ← `sources.file_name` |
| `media_type` | string | 媒体类型 ← `sources.media_type` |
| `source_type` | string | 来源类型 ← `sources.source_type` |
| `author` | string\|null | 作者 ← `sources.author` |
| `captured_at` | string\|null | 采集时间 ← `sources.captured_at` |
| `sensitivity` | string | 敏感度 ← `sources.sensitivity` |
| `extraction_status` | string | 解析状态 ← `sources.extraction_status` |
| `blob_id` | string | 存储对象 ID ← `sources.blob_id` |
| `byte_size` | integer | 文件大小（字节） ← `blobs.byte_size` |
| `sha256` | string | 文件哈希 ← `blobs.sha256` |
| `created_by` | string | 上传者 ID ← `sources.created_by` |
| `created_at` | string | 创建时间 ← `sources.created_at` |

### 7.2 查询来源列表

`GET /api/projects/:id/sources` 返回解析状态。

**响应示例**：

```json
{
  "data": [
    {
      "id": "SRC_001",
      "file_name": "需求访谈记录.pdf",
      "media_type": "application/pdf",
      "source_type": "document",
      "sensitivity": "confidential",
      "extraction_status": "parsed",
      "byte_size": 2457600,
      "created_by": "USR_001",
      "created_at": "2026-07-01T15:00:00Z"
    },
    {
      "id": "SRC_002",
      "file_name": "竞品分析.xlsx",
      "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "source_type": "document",
      "sensitivity": "internal",
      "extraction_status": "uploaded",
      "byte_size": 102400,
      "created_by": "USR_001",
      "created_at": "2026-07-01T15:05:00Z"
    }
  ],
  "meta": {
    "request_id": "REQ_...",
    "cursor": "SRC_002",
    "has_more": false
  }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 来源 ID ← `sources.id` |
| `file_name` | string | 文件名 ← `sources.file_name` |
| `media_type` | string | 媒体类型 ← `sources.media_type` |
| `source_type` | string | 来源类型 ← `sources.source_type` |
| `sensitivity` | string | 敏感度 ← `sources.sensitivity` |
| `extraction_status` | string | 解析状态 ← `sources.extraction_status` |
| `byte_size` | integer | 文件大小（字节） ← `blobs.byte_size` |
| `created_by` | string | 上传者 ID ← `sources.created_by` |
| `created_at` | string | 创建时间 ← `sources.created_at` |

### 7.3 获取证据

`GET /api/evidence/:id` 返回授权范围内的精确片段和定位信息。

**响应示例**：

```json
{
  "data": {
    "id": "EVS_...",
    "source_id": "SRC_001",
    "page": 3,
    "section": "3.2 非功能性需求",
    "coordinate_space": "normalized_unicode_codepoint_v1",
    "start_offset": 1200,
    "end_offset": 1450,
    "exact_text": "系统响应时间应在 200ms 以内，并发用户数不低于 500。",
    "normalized_text": "系统响应时间应在 200ms 以内，并发用户数不低于 500。",
    "span_hash": "sha256:...",
    "created_at": "2026-07-01T15:10:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 证据片段 ID ← `evidence_spans.id` |
| `source_id` | string | 所属来源 ID ← `evidence_spans.source_id` |
| `page` | integer\|null | 页码 ← `evidence_spans.page` |
| `section` | string\|null | 章节 ← `evidence_spans.section` |
| `coordinate_space` | string | 坐标空间 ← `evidence_spans.coordinate_space` |
| `start_offset` | integer | 起始偏移 ← `evidence_spans.start_offset` |
| `end_offset` | integer | 结束偏移 ← `evidence_spans.end_offset` |
| `exact_text` | string | 精确文本 ← `evidence_spans.exact_text` |
| `normalized_text` | string | 标准化文本 ← `evidence_spans.normalized_text` |
| `span_hash` | string | 片段哈希 ← `evidence_spans.span_hash` |
| `created_at` | string | 创建时间 ← `evidence_spans.created_at` |

v1 上传安全默认值属于 `[E]`，可配置但不能静默放宽：单文件 ≤25 MiB、单项目待处理总量 ≤100 MiB；允许 PDF、DOCX、TXT、MD、CSV、PNG、JPEG；按文件签名和 MIME 双重校验；拒绝可执行文件、宏、密码保护文件、嵌套压缩包和超限图片/PDF 页面；解析/OCR 有页数、像素、时间和内存上限。封闭本地试点至少执行文件签名、压缩炸弹和路径穿越检查；开放网络前必须增加恶意软件扫描、速率限制和隔离区。

任何真实 AI 命令执行前必须再次校验有效协议同意。服务端自动检测并移除或掩码密钥、访问令牌等高风险秘密，只选择完成任务所需片段，并记录实际发送内容哈希；这些措施不是用户可选策略。未同意、已撤回或重大版本待重新同意时返回 `403 AGREEMENT_REQUIRED`，不得创建外部请求。

## 8. 分析与异步作业

### 8.1 发起结构化提取分析

`POST /api/projects/:id/analysis-runs` 请求：

```json
{
  "task": "structured_extraction",
  "source_ids": ["SRC_..."],
  "domain_profile_id": "DP_...",
  "domain_profile_version": 2,
  "domain_pack_versions": ["software-delivery@1.0.0"],
  "expected_project_version": 8
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `task` | string | 是 | 任务类型：`structured_extraction` / `domain_profile` ← `ai_jobs.task_type` |
| `source_ids` | array | 否 | 来源 ID 列表 ← 关联 `sources.id` |
| `domain_profile_id` | string | 是 | 已批准领域画像 ID ← `ai_runs.domain_profile_id` |
| `domain_profile_version` | integer | 是 | 画像版本号 ← `ai_runs.domain_profile_version` |
| `domain_pack_versions` | array | 否 | 领域包版本列表，格式 `{pack_id}@{version}` ← `ai_runs.domain_pack_versions_json` |
| `expected_project_version` | integer | 是 | 项目版本号，用于并发控制 |

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

分析结果通过轮询获取（result 类型：`analysis_result`）。原始响应字段（通过 Job 结果返回，不在 202 响应中）：`run_id`、`task`、`created_at`。

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）；触发真实 AI 分析需有效 `agreement_consents` 记录（未同意返回 `403 AGREEMENT_REQUIRED`，见 §2.2）。

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "TOKEN_BUDGET_EXCEEDED",
    "message": "项目 Token 预算不足，无法发起分析。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**（通过 Job 结果返回，不在 202 响应中）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `job_id` | string | 异步作业 ID ← `ai_jobs.id` |
| `run_id` | string | 本次运行 ID ← `ai_runs.id` |
| `task` | string | 任务类型 ← `ai_jobs.task_type` |
| `status` | string | 作业状态 ← `ai_jobs.status` |
| `created_at` | string | 创建时间 ← `ai_jobs.created_at` |

Job 固定输入哈希、模型/Prompt/Schema/领域版本与预算；重试不得改变固定输入。

### 8.2 轮询作业状态

`GET /api/ai-jobs/:id`：状态、进度、可恢复错误和结果引用。

**授权**：正式项目 Job 要求当前用户至少具有该项目读取能力；快速问诊或训练 Job 允许当前所有用户查询，游客必须持有其所属 `guest_session` 凭证。作用域不属于当前主体时统一返回 `404 RESOURCE_NOT_FOUND`，不得通过 Job ID 枚举他人任务。

**轮询策略**：

- **退避策略**：客户端应使用指数退避，序列为 **2s → 4s → 8s → 16s → 30s（上限）**。首次请求后等待 2 秒再发起第二次，之后每次等待时间翻倍，最大间隔 30 秒。
- **最大轮询时间**：10 分钟。超时后客户端应提示用户"分析耗时较长，请稍后刷新页面查看结果"，并停止轮询。
- **轮询响应体**必须包含以下字段：`status`（当前状态）、`progress`（完成百分比，0-100）、`current_step`（当前步骤描述）、`result`（仅在 `succeeded` 时包含结果引用）。
- `[E]` 实现阶段可能根据实际模型响应时间调整退避参数和最大轮询时间。
- 不承诺 SSE 或 `Last-Event-ID`。只有轮询经测量成为瓶颈且能够提供持久化事件 ID、顺序、保留期和断线恢复契约时才引入 SSE。
- 状态流程：`queued → running → validating → succeeded`；可恢复失败进入 `retry_wait`；需要人工处理时进入 `manual_review`；不可恢复错误进入 `failed`。最终失败保留最后成功版本，不能将旧结果标为本次成功。

**响应示例**（处理中）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "task": "structured_extraction",
    "status": "running",
    "progress": 45,
    "current_step": "正在提取 Outcome 实体……",
    "attempts": 1,
    "max_attempts": 3,
    "result": null,
    "created_at": "2026-07-01T16:00:00Z",
    "updated_at": "2026-07-01T16:01:30Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应示例**（已完成）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "task": "structured_extraction",
    "status": "succeeded",
    "progress": 100,
    "current_step": "分析完成",
    "attempts": 1,
    "max_attempts": 3,
    "result": {
      "result_type": "analysis_result",
      "run_id": "RUN_...",
      "outcome_count": 3,
      "requirement_count": 12,
      "driver_count": 5,
      "conflict_count": 2,
      "parsed_output_hash": "sha256:..."
    },
    "created_at": "2026-07-01T16:00:00Z",
    "updated_at": "2026-07-01T16:03:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `job_id` | string | 作业 ID ← `ai_jobs.id` |
| `task` | string | 任务类型 ← `ai_jobs.task_type` |
| `status` | string | 作业状态 ← `ai_jobs.status` |
| `progress` | integer | 完成百分比（0-100），计算字段 |
| `current_step` | string | 当前步骤描述，计算字段 |
| `attempts` | integer | 已尝试次数 ← `ai_jobs.attempts` |
| `max_attempts` | integer | 最大尝试次数 ← `ai_jobs.max_attempts` |
| `result` | object\|null | 结果引用，仅 `succeeded` 时包含 |
| `last_error_code` | string\|null | 最近错误码，仅 `failed` 时包含 ← `ai_jobs.last_error_code` |
| `completed_at` | string\|null | 终态完成时间；可由 `ai_runs.completed_at` 或终态 `updated_at` 计算投影 |
| `duration_ms` | integer\|null | 从 `created_at` 到 `completed_at` 的计算耗时 |
| `created_at` | string | 创建时间 ← `ai_jobs.created_at` |
| `updated_at` | string | 更新时间 ← `ai_jobs.updated_at` |

### 8.3 取消作业

`POST /api/ai-jobs/:id/cancel`：仅取消未完成任务，不回滚已经成功提交的领域事务。

**请求示例**：

```json
{
  "reason": "用户不再需要此分析结果"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `reason` | string | 是 | 取消原因 ← `ai_jobs.cancellation_reason` |

**响应示例**：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "cancelled",
    "cancellation_reason": "用户不再需要此分析结果",
    "cancelled_by_kind": "user",
    "cancelled_by": "USR_001",
    "cancelled_at": "2026-07-01T16:05:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

`cancelled_by_kind` 为 `user | guest`，`cancelled_by` 分别投影 `users.id` 或 `guest_sessions.id`；显式取消响应不会返回系统内部取消者。

**授权**：正式项目 Job 需 `编辑内容/发起分析` 能力；快速问诊或训练 Job 允许其当前所有用户取消，游客必须持有所属 `guest_session` 凭证。作用域不属于当前主体时统一返回 `404 RESOURCE_NOT_FOUND`。

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "作业已完成或已取消，无法再次取消。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `job_id` | string | 作业 ID ← `ai_jobs.id` |
| `status` | string | 作业状态 ← `ai_jobs.status` |
| `cancellation_reason` | string | 取消原因 ← `ai_jobs.cancellation_reason` |
| `cancelled_by` | string | 取消者 ID ← `ai_jobs.cancelled_by` |
| `cancelled_at` | string | 取消时间 ← `ai_jobs.cancelled_at` |

## 9. 分析对象、评审和人工关口

### 9.0a 查询正式访谈记录

`GET /api/projects/:id/interview-turns`：返回正式项目访谈轮次，用于页面恢复、筛选和证据跳转。该端点只读，不触发 AI 追问。

**查询参数**：`limit`、`cursor`、`role=interviewer|stakeholder|system`。

**响应字段**：`id/project_id/turn_index/role/stakeholder_id/speaker_label/content/evidence_span_id/created_at`。`evidence_span_id` 非空时可以跳转到 `GET /api/evidence/:id` 所在来源片段；为空表示该轮为手工记录或尚未落入证据片段。

### 9.0b 查询相关角色

`GET /api/projects/:id/stakeholders`：返回正式项目识别到的利益相关者、使用者、决策者或责任角色。该端点用于建档、访谈和范围确认页面的角色筛选，不代表所有角色都已接受。

**响应字段**：`id/project_id/name/role/influence/interest/authority/contact_scope/notes/epistemic_type/status/version/created_at/updated_at`。

### 9.0c 查询证据与追踪关系

`GET /api/projects/:id/evidence-links`：按 `entity_type` + `entity_id` 查询实体到 EvidenceSpan 的支持、反驳、限定或来源关系。

`GET /api/projects/:id/trace-links`：按 `from_type/from_id/to_type/to_id` 查询实体间追踪链。

两者都只读，不自动修复断裂关系。关系完整性由数据库 Repository 写入校验和发布/批准前门禁处理；前端不得把 Outcome、Requirement 或 Conflict ID 当作 EvidenceSpan ID 直接跳转。

### 9.1 查询成果列表

`GET /api/projects/:id/outcomes`：按状态、版本和认识类型查询。

**响应示例**：

```json
{
  "data": [
    {
      "id": "OUT_...",
      "project_id": "PRJ_...",
      "driver_id": "DRV_001",
      "job_id": "JOB_001",
      "description": "患者在线问诊等待时间从平均 30 分钟降至 5 分钟以内",
      "success_metric": "平均等待时间",
      "baseline_value": "30",
      "target_value": "5",
      "unit": "分钟",
      "failure_condition": "等待时间超过 10 分钟",
      "horizon": "now",
      "owner_id": "USR_001",
      "epistemic_type": "Proposal",
      "status": "candidate",
      "version": 1,
      "created_at": "2026-07-01T16:00:00Z",
      "updated_at": "2026-07-01T16:00:00Z"
    }
  ],
  "meta": {
    "request_id": "REQ_...",
    "cursor": "OUT_...",
    "has_more": false
  }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 成果 ID ← `outcomes.id` |
| `project_id` | string | 项目 ID ← `outcomes.project_id` |
| `driver_id` | string | 关联 Driver ID ← `outcomes.driver_id` |
| `job_id` | string\|null | 关联 Job ID ← `outcomes.job_id` |
| `description` | string | 成果描述 ← `outcomes.description` |
| `success_metric` | string\|null | 成功指标 ← `outcomes.success_metric` |
| `baseline_value` | string\|null | 基线值 ← `outcomes.baseline_value` |
| `target_value` | string\|null | 目标值 ← `outcomes.target_value` |
| `unit` | string\|null | 单位 ← `outcomes.unit` |
| `failure_condition` | string\|null | 失败条件 ← `outcomes.failure_condition` |
| `horizon` | string\|null | 时间范围 ← `outcomes.horizon` |
| `owner_id` | string\|null | 负责人 ID ← `outcomes.owner_id` |
| `epistemic_type` | string | 认识类型 ← `outcomes.epistemic_type` |
| `status` | string | 状态 ← `outcomes.status` |
| `version` | integer | 乐观锁版本 ← `outcomes.version` |
| `created_at` | string | 创建时间 ← `outcomes.created_at` |
| `updated_at` | string | 更新时间 ← `outcomes.updated_at` |

### 9.2 查询需求列表

`GET /api/projects/:id/requirements`：按状态、版本和认识类型查询。

**响应示例**：

```json
{
  "data": [
    {
      "id": "REQ_...",
      "project_id": "PRJ_...",
      "requirement_key": "REQ-PERF-001",
      "title": "问诊响应时间",
      "statement": "系统应在 200ms 内响应用户问诊请求",
      "requirement_type": "performance",
      "provenance": "explicitly_stated",
      "horizon": "now",
      "scope_disposition": "included",
      "commitment": "committed",
      "stability": "stable",
      "priority": "high",
      "valid_from": "2026-07-01T00:00:00Z",
      "valid_until": null,
      "activation_trigger": null,
      "deactivation_trigger": null,
      "volatility_drivers": [],
      "migration_strategy": null,
      "reversibility": "low",
      "owner_id": "USR_001",
      "lifecycle_status": "candidate",
      "rationale": "来源于用户访谈中对响应速度的明确要求",
      "version": 1,
      "created_at": "2026-07-01T16:00:00Z",
      "updated_at": "2026-07-01T16:00:00Z"
    }
  ],
  "meta": {
    "request_id": "REQ_...",
    "cursor": "REQ_...",
    "has_more": false
  }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 需求 ID ← `requirements.id` |
| `project_id` | string | 项目 ID ← `requirements.project_id` |
| `requirement_key` | string | 需求键 ← `requirements.requirement_key` |
| `title` | string\|null | 标题 ← `requirements.title` |
| `statement` | string | 需求陈述 ← `requirements.statement` |
| `requirement_type` | string | 需求类型 ← `requirements.requirement_type` |
| `provenance` | string | 来源类型 ← `requirements.provenance` |
| `horizon` | string\|null | 时间范围 ← `requirements.horizon` |
| `scope_disposition` | string | 范围处置 ← `requirements.scope_disposition` |
| `commitment` | string | 承诺级别 ← `requirements.commitment` |
| `stability` | string | 稳定性 ← `requirements.stability` |
| `priority` | string\|null | 优先级 ← `requirements.priority` |
| `valid_from` | string\|null | 生效时间 ← `requirements.valid_from` |
| `valid_until` | string\|null | 失效时间 ← `requirements.valid_until` |
| `lifecycle_status` | string | 生命周期状态 ← `requirements.lifecycle_status` |
| `rationale` | string\|null | 理由说明 ← `requirements.rationale` |
| `version` | integer | 乐观锁版本 ← `requirements.version` |
| `created_at` | string | 创建时间 ← `requirements.created_at` |
| `updated_at` | string | 更新时间 ← `requirements.updated_at` |

### 9.3 Driver 管理

#### GET /api/projects/:id/drivers

查询项目的所有 Driver。

**响应示例**：

```json
{
  "data": [
    {
      "id": "DRV_001",
      "project_id": "PRJ_...",
      "driver_type": "outcome",
      "statement": "减少患者平均等待时间",
      "owner_id": "USR_001",
      "status": "candidate",
      "version": 1,
      "created_at": "2026-07-01T16:00:00Z",
      "updated_at": "2026-07-01T16:00:00Z"
    },
    {
      "id": "DRV_002",
      "project_id": "PRJ_...",
      "driver_type": "risk",
      "statement": "患者数据隐私泄露风险",
      "owner_id": "USR_002",
      "status": "candidate",
      "version": 1,
      "created_at": "2026-07-01T16:05:00Z",
      "updated_at": "2026-07-01T16:05:00Z"
    }
  ],
  "meta": {
    "request_id": "REQ_...",
    "cursor": "DRV_002",
    "has_more": false
  }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | Driver ID ← `drivers.id` |
| `project_id` | string | 项目 ID ← `drivers.project_id` |
| `driver_type` | string | Driver 类型 ← `drivers.driver_type` |
| `statement` | string | 陈述 ← `drivers.statement` |
| `owner_id` | string\|null | 负责人 ID ← `drivers.owner_id` |
| `status` | string | 状态 ← `drivers.status` |
| `version` | integer | 乐观锁版本 ← `drivers.version` |
| `created_at` | string | 创建时间 ← `drivers.created_at` |
| `updated_at` | string | 更新时间 ← `drivers.updated_at` |

#### POST /api/projects/:id/drivers

创建新 Driver。

**请求示例**：

```json
{
  "driver_type": "goal",
  "statement": "构建覆盖全市的在线问诊网络",
  "owner_id": "USR_001"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `driver_type` | string | 是 | Driver 类型 ← `drivers.driver_type` |
| `statement` | string | 是 | Driver 陈述 ← `drivers.statement` |
| `owner_id` | string\|null | 否 | 负责人 ID ← `drivers.owner_id` |

**响应示例**：

```json
{
  "data": {
    "id": "DRV_003",
    "project_id": "PRJ_...",
    "driver_type": "goal",
    "statement": "构建覆盖全市的在线问诊网络",
    "owner_id": "USR_001",
    "status": "candidate",
    "version": 1,
    "created_at": "2026-07-01T16:10:00Z",
    "updated_at": "2026-07-01T16:10:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：driver_type、statement。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | Driver ID ← `drivers.id` |
| `project_id` | string | 项目 ID ← `drivers.project_id` |
| `driver_type` | string | Driver 类型 ← `drivers.driver_type` |
| `statement` | string | 陈述 ← `drivers.statement` |
| `owner_id` | string\|null | 负责人 ID ← `drivers.owner_id` |
| `status` | string | 状态 ← `drivers.status` |
| `version` | integer | 乐观锁版本 ← `drivers.version` |
| `created_at` | string | 创建时间 ← `drivers.created_at` |
| `updated_at` | string | 更新时间 ← `drivers.updated_at` |

#### PATCH /api/drivers/:id

修改 Driver，需 `expected_version`。

**请求示例**：

```json
{
  "statement": "构建覆盖全市及周边县域的在线问诊网络",
  "owner_id": "USR_002",
  "expected_version": 1
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `statement` | string | 否 | 更新后的陈述 ← `drivers.statement` |
| `owner_id` | string\|null | 否 | 负责人 ID ← `drivers.owner_id` |
| `status` | string | 否 | 状态 ← `drivers.status` |
| `expected_version` | integer | 是 | 乐观锁版本号 |

**响应示例**：

```json
{
  "data": {
    "id": "DRV_003",
    "project_id": "PRJ_...",
    "driver_type": "goal",
    "statement": "构建覆盖全市及周边县域的在线问诊网络",
    "owner_id": "USR_002",
    "status": "candidate",
    "version": 2,
    "created_at": "2026-07-01T16:10:00Z",
    "updated_at": "2026-07-01T16:15:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**错误示例**：
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | Driver ID ← `drivers.id` |
| `project_id` | string | 项目 ID ← `drivers.project_id` |
| `driver_type` | string | Driver 类型 ← `drivers.driver_type` |
| `statement` | string | 陈述 ← `drivers.statement` |
| `owner_id` | string\|null | 负责人 ID ← `drivers.owner_id` |
| `status` | string | 状态 ← `drivers.status` |
| `version` | integer | 更新后的乐观锁版本 ← `drivers.version` |
| `created_at` | string | 创建时间 ← `drivers.created_at` |
| `updated_at` | string | 更新时间 ← `drivers.updated_at` |

### 9.4 Outcome 修改

#### PATCH /api/outcomes/:id

维护 Job 关联、成功指标、基准、目标、单位、失败条件、时间和责任人，需 `expected_version`。

**请求示例**：

```json
{
  "description": "患者在线问诊等待时间从平均 30 分钟降至 3 分钟以内",
  "success_metric": "平均等待时间",
  "baseline_value": "30",
  "target_value": "3",
  "unit": "分钟",
  "failure_condition": "等待时间超过 8 分钟",
  "horizon": "now",
  "owner_id": "USR_001",
  "expected_version": 1
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `description` | string | 否 | 成果描述 ← `outcomes.description` |
| `success_metric` | string\|null | 否 | 成功指标 ← `outcomes.success_metric` |
| `baseline_value` | string\|null | 否 | 基线值 ← `outcomes.baseline_value` |
| `target_value` | string\|null | 否 | 目标值 ← `outcomes.target_value` |
| `unit` | string\|null | 否 | 单位 ← `outcomes.unit` |
| `failure_condition` | string\|null | 否 | 失败条件 ← `outcomes.failure_condition` |
| `horizon` | string\|null | 否 | 时间范围 ← `outcomes.horizon` |
| `owner_id` | string\|null | 否 | 负责人 ID ← `outcomes.owner_id` |
| `job_id` | string\|null | 否 | 关联 Job ID ← `outcomes.job_id` |
| `expected_version` | integer | 是 | 乐观锁版本号 |

**响应示例**：

```json
{
  "data": {
    "id": "OUT_...",
    "project_id": "PRJ_...",
    "driver_id": "DRV_001",
    "description": "患者在线问诊等待时间从平均 30 分钟降至 3 分钟以内",
    "success_metric": "平均等待时间",
    "baseline_value": "30",
    "target_value": "3",
    "unit": "分钟",
    "failure_condition": "等待时间超过 8 分钟",
    "horizon": "now",
    "owner_id": "USR_001",
    "status": "candidate",
    "version": 2,
    "updated_at": "2026-07-01T16:20:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**错误示例**：
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 成果 ID ← `outcomes.id` |
| `project_id` | string | 项目 ID ← `outcomes.project_id` |
| `driver_id` | string | 关联 Driver ID ← `outcomes.driver_id` |
| `description` | string | 成果描述 ← `outcomes.description` |
| `success_metric` | string\|null | 成功指标 ← `outcomes.success_metric` |
| `baseline_value` | string\|null | 基线值 ← `outcomes.baseline_value` |
| `target_value` | string\|null | 目标值 ← `outcomes.target_value` |
| `unit` | string\|null | 单位 ← `outcomes.unit` |
| `failure_condition` | string\|null | 失败条件 ← `outcomes.failure_condition` |
| `horizon` | string\|null | 时间范围 ← `outcomes.horizon` |
| `owner_id` | string\|null | 负责人 ID ← `outcomes.owner_id` |
| `status` | string | 状态 ← `outcomes.status` |
| `version` | integer | 更新后的乐观锁版本 ← `outcomes.version` |
| `updated_at` | string | 更新时间 ← `outcomes.updated_at` |

### 9.5 Requirement 修改

#### PATCH /api/requirements/:id

Editor 修改并产生新版本，需 `expected_version`。

**请求示例**：

```json
{
  "title": "问诊响应时间（修订）",
  "statement": "系统应在 150ms 内响应用户问诊请求，P99 不超过 300ms",
  "requirement_type": "performance",
  "commitment": "committed",
  "stability": "stable",
  "priority": "critical",
  "horizon": "now",
  "scope_disposition": "included",
  "owner_id": "USR_001",
  "rationale": "根据竞品分析和医院方要求，将响应时间目标收紧至 150ms",
  "expected_version": 1
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `title` | string\|null | 否 | 标题 ← `requirements.title` |
| `statement` | string | 否 | 需求陈述 ← `requirements.statement` |
| `requirement_type` | string | 否 | 需求类型 ← `requirements.requirement_type` |
| `commitment` | string | 否 | 承诺级别 ← `requirements.commitment` |
| `stability` | string | 否 | 稳定性 ← `requirements.stability` |
| `priority` | string\|null | 否 | 优先级 ← `requirements.priority` |
| `horizon` | string\|null | 否 | 时间范围 ← `requirements.horizon` |
| `scope_disposition` | string | 否 | 范围处置 ← `requirements.scope_disposition` |
| `owner_id` | string\|null | 否 | 负责人 ID ← `requirements.owner_id` |
| `rationale` | string\|null | 否 | 理由说明 ← `requirements.rationale` |
| `valid_from` | string\|null | 否 | 生效时间 ← `requirements.valid_from` |
| `valid_until` | string\|null | 否 | 失效时间 ← `requirements.valid_until` |
| `expected_version` | integer | 是 | 乐观锁版本号 |

**响应示例**：

```json
{
  "data": {
    "id": "REQ_...",
    "project_id": "PRJ_...",
    "requirement_key": "REQ-PERF-001",
    "title": "问诊响应时间（修订）",
    "statement": "系统应在 150ms 内响应用户问诊请求，P99 不超过 300ms",
    "requirement_type": "performance",
    "provenance": "explicitly_stated",
    "horizon": "now",
    "scope_disposition": "included",
    "commitment": "committed",
    "stability": "stable",
    "priority": "critical",
    "owner_id": "USR_001",
    "lifecycle_status": "candidate",
    "rationale": "根据竞品分析和医院方要求，将响应时间目标收紧至 150ms",
    "version": 2,
    "updated_at": "2026-07-01T16:25:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**错误示例**：
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "对象已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 需求 ID ← `requirements.id` |
| `project_id` | string | 项目 ID ← `requirements.project_id` |
| `requirement_key` | string | 需求键 ← `requirements.requirement_key` |
| `title` | string\|null | 标题 ← `requirements.title` |
| `statement` | string | 需求陈述 ← `requirements.statement` |
| `requirement_type` | string | 需求类型 ← `requirements.requirement_type` |
| `provenance` | string | 来源类型 ← `requirements.provenance` |
| `horizon` | string\|null | 时间范围 ← `requirements.horizon` |
| `scope_disposition` | string | 范围处置 ← `requirements.scope_disposition` |
| `commitment` | string | 承诺级别 ← `requirements.commitment` |
| `stability` | string | 稳定性 ← `requirements.stability` |
| `priority` | string\|null | 优先级 ← `requirements.priority` |
| `owner_id` | string\|null | 负责人 ID ← `requirements.owner_id` |
| `lifecycle_status` | string | 生命周期状态 ← `requirements.lifecycle_status` |
| `rationale` | string\|null | 理由说明 ← `requirements.rationale` |
| `version` | integer | 更新后的乐观锁版本 ← `requirements.version` |
| `updated_at` | string | 更新时间 ← `requirements.updated_at` |

### 9.6 验收标准管理

#### GET /api/requirements/:id/acceptance-criteria

查询需求的验收/评价标准列表。

**响应示例**：

```json
{
  "data": [
    {
      "id": "AC_001",
      "project_id": "PRJ_...",
      "requirement_id": "REQ_...",
      "context": "正常网络环境下",
      "action_or_condition": "发送问诊请求",
      "expected_result": "系统在 200ms 内返回响应",
      "measurement_method": "性能测试工具",
      "evidence_type": "test_report",
      "threshold_value": "200",
      "unit": "ms",
      "status": "draft",
      "version": 1,
      "created_at": "2026-07-01T16:30:00Z",
      "updated_at": "2026-07-01T16:30:00Z"
    }
  ],
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 验收标准 ID ← `acceptance_criteria.id` |
| `project_id` | string | 项目 ID ← `acceptance_criteria.project_id` |
| `requirement_id` | string | 需求 ID ← `acceptance_criteria.requirement_id` |
| `context` | string\|null | 前置条件 ← `acceptance_criteria.context` |
| `action_or_condition` | string | 动作或条件 ← `acceptance_criteria.action_or_condition` |
| `expected_result` | string | 预期结果 ← `acceptance_criteria.expected_result` |
| `measurement_method` | string\|null | 度量方法 ← `acceptance_criteria.measurement_method` |
| `evidence_type` | string\|null | 证据类型 ← `acceptance_criteria.evidence_type` |
| `threshold_value` | string\|null | 阈值 ← `acceptance_criteria.threshold_value` |
| `unit` | string\|null | 单位 ← `acceptance_criteria.unit` |
| `status` | string | 状态 ← `acceptance_criteria.status` |
| `version` | integer | 乐观锁版本 ← `acceptance_criteria.version` |
| `created_at` | string | 创建时间 ← `acceptance_criteria.created_at` |
| `updated_at` | string | 更新时间 ← `acceptance_criteria.updated_at` |

#### POST /api/requirements/:id/acceptance-criteria

新增验收/评价标准。

**请求示例**：

```json
{
  "context": "高并发场景（500 并发用户）",
  "action_or_condition": "同时发送问诊请求",
  "expected_result": "P95 响应时间不超过 500ms",
  "measurement_method": "JMeter 压力测试",
  "evidence_type": "test_report",
  "threshold_value": "500",
  "unit": "ms"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `context` | string\|null | 否 | 前置条件 ← `acceptance_criteria.context` |
| `action_or_condition` | string | 是 | 动作或条件 ← `acceptance_criteria.action_or_condition` |
| `expected_result` | string | 是 | 预期结果 ← `acceptance_criteria.expected_result` |
| `measurement_method` | string\|null | 否 | 度量方法 ← `acceptance_criteria.measurement_method` |
| `evidence_type` | string\|null | 否 | 证据类型 ← `acceptance_criteria.evidence_type` |
| `threshold_value` | string\|null | 否 | 阈值 ← `acceptance_criteria.threshold_value` |
| `unit` | string\|null | 否 | 单位 ← `acceptance_criteria.unit` |

**响应示例**：

```json
{
  "data": {
    "id": "AC_002",
    "project_id": "PRJ_...",
    "requirement_id": "REQ_...",
    "context": "高并发场景（500 并发用户）",
    "action_or_condition": "同时发送问诊请求",
    "expected_result": "P95 响应时间不超过 500ms",
    "measurement_method": "JMeter 压力测试",
    "evidence_type": "test_report",
    "threshold_value": "500",
    "unit": "ms",
    "status": "draft",
    "version": 1,
    "created_at": "2026-07-01T16:35:00Z",
    "updated_at": "2026-07-01T16:35:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：action_or_condition、expected_result。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 验收标准 ID ← `acceptance_criteria.id` |
| `project_id` | string | 项目 ID ← `acceptance_criteria.project_id` |
| `requirement_id` | string | 需求 ID ← `acceptance_criteria.requirement_id` |
| `context` | string\|null | 前置条件 ← `acceptance_criteria.context` |
| `action_or_condition` | string | 动作或条件 ← `acceptance_criteria.action_or_condition` |
| `expected_result` | string | 预期结果 ← `acceptance_criteria.expected_result` |
| `measurement_method` | string\|null | 度量方法 ← `acceptance_criteria.measurement_method` |
| `evidence_type` | string\|null | 证据类型 ← `acceptance_criteria.evidence_type` |
| `threshold_value` | string\|null | 阈值 ← `acceptance_criteria.threshold_value` |
| `unit` | string\|null | 单位 ← `acceptance_criteria.unit` |
| `status` | string | 状态 ← `acceptance_criteria.status` |
| `version` | integer | 乐观锁版本 ← `acceptance_criteria.version` |
| `created_at` | string | 创建时间 ← `acceptance_criteria.created_at` |
| `updated_at` | string | 更新时间 ← `acceptance_criteria.updated_at` |

### 9.7 验证工件

#### POST /api/requirements/:id/verification-artifacts

登记验证工件、来源与结果。

**请求示例**：

```json
{
  "acceptance_criterion_id": "AC_001",
  "artifact_type": "test_report",
  "description": "性能测试报告 - 2026Q3",
  "source_id": "SRC_005",
  "result": "passed",
  "executed_at": "2026-07-01T16:00:00Z"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `acceptance_criterion_id` | string\|null | 否 | 关联验收标准 ID ← `verification_artifacts.acceptance_criterion_id` |
| `artifact_type` | string | 是 | 工件类型 ← `verification_artifacts.artifact_type` |
| `description` | string\|null | 否 | 描述 ← `verification_artifacts.description` |
| `source_id` | string\|null | 否 | 关联来源 ID ← `verification_artifacts.source_id` |
| `result` | string\|null | 否 | 验证结果 ← `verification_artifacts.result` |
| `executed_at` | string\|null | 否 | 执行时间 ← `verification_artifacts.executed_at` |

**响应示例**：

```json
{
  "data": {
    "id": "VA_...",
    "project_id": "PRJ_...",
    "requirement_id": "REQ_...",
    "acceptance_criterion_id": "AC_001",
    "artifact_type": "test_report",
    "description": "性能测试报告 - 2026Q3",
    "source_id": "SRC_005",
    "result": "passed",
    "executed_at": "2026-07-01T16:00:00Z",
    "status": "available",
    "created_at": "2026-07-01T16:40:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：artifact_type。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 验证工件 ID ← `verification_artifacts.id` |
| `project_id` | string | 项目 ID ← `verification_artifacts.project_id` |
| `requirement_id` | string | 需求 ID ← `verification_artifacts.requirement_id` |
| `acceptance_criterion_id` | string\|null | 关联验收标准 ID ← `verification_artifacts.acceptance_criterion_id` |
| `artifact_type` | string | 工件类型 ← `verification_artifacts.artifact_type` |
| `description` | string\|null | 描述 ← `verification_artifacts.description` |
| `source_id` | string\|null | 关联来源 ID ← `verification_artifacts.source_id` |
| `result` | string\|null | 验证结果 ← `verification_artifacts.result` |
| `executed_at` | string\|null | 执行时间 ← `verification_artifacts.executed_at` |
| `status` | string | 状态 ← `verification_artifacts.status` |
| `created_at` | string | 创建时间 ← `verification_artifacts.created_at` |

### 9.8 持续观测信号

#### GET /api/requirements/:id/operational-signals

查询持续观测定义与状态。

**响应示例**：

```json
{
  "data": [
    {
      "id": "OPS_001",
      "project_id": "PRJ_...",
      "requirement_id": "REQ_...",
      "name": "问诊响应时间 P99",
      "measurement": "每 5 分钟采集 P99 响应时间",
      "threshold_value": "300",
      "unit": "ms",
      "observation_window": "7d",
      "owner_id": "USR_001",
      "review_cadence": "weekly",
      "trigger_condition": "P99 > 300ms 持续超过 1 小时",
      "status": "active",
      "version": 1,
      "created_at": "2026-07-01T16:45:00Z",
      "updated_at": "2026-07-01T16:45:00Z"
    }
  ],
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 信号 ID ← `operational_signals.id` |
| `project_id` | string | 项目 ID ← `operational_signals.project_id` |
| `requirement_id` | string | 需求 ID ← `operational_signals.requirement_id` |
| `name` | string | 信号名称 ← `operational_signals.name` |
| `measurement` | string | 度量方式 ← `operational_signals.measurement` |
| `threshold_value` | string\|null | 阈值 ← `operational_signals.threshold_value` |
| `unit` | string\|null | 单位 ← `operational_signals.unit` |
| `observation_window` | string\|null | 观测窗口 ← `operational_signals.observation_window` |
| `owner_id` | string\|null | 负责人 ID ← `operational_signals.owner_id` |
| `review_cadence` | string\|null | 审查周期 ← `operational_signals.review_cadence` |
| `trigger_condition` | string\|null | 触发条件 ← `operational_signals.trigger_condition` |
| `status` | string | 状态 ← `operational_signals.status` |
| `version` | integer | 乐观锁版本 ← `operational_signals.version` |
| `created_at` | string | 创建时间 ← `operational_signals.created_at` |
| `updated_at` | string | 更新时间 ← `operational_signals.updated_at` |

### 9.9 未来场景

#### GET /api/projects/:id/future-scenarios

查询 Next/Later/Watch 的触发情景和领先指标。

**响应示例**：

```json
{
  "data": [
    {
      "id": "FSC_001",
      "project_id": "PRJ_...",
      "name": "日均问诊量突破 10000",
      "description": "当平台日均问诊量突破 10000 时，需要评估系统架构是否需要水平扩展",
      "probability_class": "medium",
      "activation_trigger": "日均问诊量连续 3 天超过 10000",
      "leading_indicators": [
        { "metric": "日均问诊量", "current": 3200, "trend": "rising" }
      ],
      "horizon": "next",
      "architecture_response": "引入消息队列和读写分离",
      "status": "active",
      "version": 1,
      "created_at": "2026-07-01T16:50:00Z",
      "updated_at": "2026-07-01T16:50:00Z"
    }
  ],
  "meta": {
    "request_id": "REQ_...",
    "cursor": "FSC_001",
    "has_more": false
  }
}
```

**响应字段**（列表项）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 场景 ID ← `future_scenarios.id` |
| `project_id` | string | 项目 ID ← `future_scenarios.project_id` |
| `name` | string | 场景名称 ← `future_scenarios.name` |
| `description` | string | 描述 ← `future_scenarios.description` |
| `probability_class` | string\|null | 概率等级 ← `future_scenarios.probability_class` |
| `activation_trigger` | string | 激活触发条件 ← `future_scenarios.activation_trigger` |
| `leading_indicators` | array | 领先指标 ← `future_scenarios.leading_indicators_json` |
| `horizon` | string | 时间范围 ← `future_scenarios.horizon` |
| `architecture_response` | string\|null | 架构响应方案 ← `future_scenarios.architecture_response` |
| `status` | string | 状态 ← `future_scenarios.status` |
| `version` | integer | 乐观锁版本 ← `future_scenarios.version` |
| `created_at` | string | 创建时间 ← `future_scenarios.created_at` |
| `updated_at` | string | 更新时间 ← `future_scenarios.updated_at` |

#### POST /api/projects/:id/future-scenarios

创建未来场景。

**请求示例**：

```json
{
  "name": "医保政策调整",
  "description": "若医保局调整在线问诊报销比例，需评估对业务模型的影响",
  "probability_class": "low",
  "activation_trigger": "医保局发布新版在线诊疗报销政策",
  "leading_indicators": [
    { "metric": "政策征求意见稿发布", "current": false, "trend": "unknown" }
  ],
  "horizon": "watch"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `name` | string | 是 | 场景名称 ← `future_scenarios.name` |
| `description` | string | 是 | 描述 ← `future_scenarios.description` |
| `probability_class` | string\|null | 否 | 概率等级 ← `future_scenarios.probability_class` |
| `activation_trigger` | string | 是 | 激活触发条件 ← `future_scenarios.activation_trigger` |
| `leading_indicators` | array | 否 | 领先指标 ← `future_scenarios.leading_indicators_json` |
| `horizon` | string | 是 | 时间范围：`next` / `later` / `watch` ← `future_scenarios.horizon` |
| `architecture_response` | string\|null | 否 | 架构响应方案 ← `future_scenarios.architecture_response` |

**响应示例**：

```json
{
  "data": {
    "id": "FSC_002",
    "project_id": "PRJ_...",
    "name": "医保政策调整",
    "description": "若医保局调整在线问诊报销比例，需评估对业务模型的影响",
    "probability_class": "low",
    "activation_trigger": "医保局发布新版在线诊疗报销政策",
    "leading_indicators": [
      { "metric": "政策征求意见稿发布", "current": false, "trend": "unknown" }
    ],
    "horizon": "watch",
    "architecture_response": null,
    "status": "draft",
    "version": 1,
    "created_at": "2026-07-01T16:55:00Z",
    "updated_at": "2026-07-01T16:55:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：name、description、activation_trigger、horizon。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 场景 ID ← `future_scenarios.id` |
| `project_id` | string | 项目 ID ← `future_scenarios.project_id` |
| `name` | string | 场景名称 ← `future_scenarios.name` |
| `description` | string | 描述 ← `future_scenarios.description` |
| `probability_class` | string\|null | 概率等级 ← `future_scenarios.probability_class` |
| `activation_trigger` | string | 激活触发条件 ← `future_scenarios.activation_trigger` |
| `leading_indicators` | array | 领先指标 ← `future_scenarios.leading_indicators_json` |
| `horizon` | string | 时间范围 ← `future_scenarios.horizon` |
| `architecture_response` | string\|null | 架构响应方案 ← `future_scenarios.architecture_response` |
| `status` | string | 状态 ← `future_scenarios.status` |
| `version` | integer | 乐观锁版本 ← `future_scenarios.version` |
| `created_at` | string | 创建时间 ← `future_scenarios.created_at` |
| `updated_at` | string | 更新时间 ← `future_scenarios.updated_at` |

### 9.10 类型化评审

#### POST /api/outcomes/:id/reviews

对 Outcome 执行类型化评审。

**请求示例**：

```json
{
  "action": "accept",
  "entity_version": 2,
  "reason": "成功指标和失败条件均已明确，可进入下一阶段"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | 评审动作：`accept` / `modify` / `reject` / `uncertain` ← `review_actions.action` |
| `entity_version` | integer | 是 | 被评审实体版本号 ← `review_actions.entity_version` |
| `reason` | string | 是 | 评审理由 ← `review_actions.reason` |
| `follow_up` | object | 否 | 跟进信息（`uncertain` 时必填） ← `review_actions.follow_up_json` |

**响应示例**：

```json
{
  "data": {
    "id": "RV_...",
    "project_id": "PRJ_...",
    "entity_type": "outcome",
    "entity_id": "OUT_...",
    "entity_version": 2,
    "action": "accept",
    "reviewer_id": "USR_001",
    "reason": "成功指标和失败条件均已明确，可进入下一阶段",
    "created_at": "2026-07-01T17:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `执行人工关口` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "当前用户无权评审此实体。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 评审记录 ID ← `review_actions.id` |
| `project_id` | string | 项目 ID ← `review_actions.project_id` |
| `entity_type` | string | 实体类型 ← `review_actions.entity_type` |
| `entity_id` | string | 实体 ID ← `review_actions.entity_id` |
| `entity_version` | integer | 实体版本 ← `review_actions.entity_version` |
| `action` | string | 评审动作 ← `review_actions.action` |
| `reviewer_id` | string | 评审者 ID ← `review_actions.reviewer_id` |
| `reason` | string | 评审理由 ← `review_actions.reason` |
| `created_at` | string | 创建时间 ← `review_actions.created_at` |

`POST /api/drivers/:id/reviews`、`POST /api/requirements/:id/reviews`、`POST /api/conflicts/:id/reviews` 的请求/响应格式与上述一致，只是 `entity_type` 分别为 `driver`、`requirement`、`conflict`。禁止客户端提交任意 `entity_type`。

### 9.11 项目关口评审

#### POST /api/projects/:id/gates/:gate/reviews

执行 `outcome | evidence_conflict | scope` 三个项目关口。

**请求示例**：

```json
{
  "action": "uncertain",
  "entity_version": 3,
  "reason": "缺少现场等待时间数据",
  "follow_up": {
    "owner_id": "USR_...",
    "required_evidence": "一周高峰期样本",
    "review_condition": "样本完成"
  }
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `action` | string | 是 | 评审动作 ← `review_actions.action` |
| `entity_version` | integer | 是 | 被评审实体版本号 ← `review_actions.entity_version` |
| `reason` | string | 是 | 评审理由 ← `review_actions.reason` |
| `follow_up` | object | 否 | 跟进信息（`uncertain` 时必填） ← `review_actions.follow_up_json` |

**响应示例**：

```json
{
  "data": {
    "id": "RV_...",
    "project_id": "PRJ_...",
    "gate": "evidence_conflict",
    "entity_type": "project",
    "entity_id": "PRJ_...",
    "entity_version": 3,
    "action": "uncertain",
    "reviewer_id": "USR_001",
    "reason": "缺少现场等待时间数据",
    "follow_up": {
      "owner_id": "USR_002",
      "required_evidence": "一周高峰期样本",
      "review_condition": "样本完成"
    },
    "created_at": "2026-07-01T17:05:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `执行人工关口` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "BLOCKING_CONFLICT",
    "message": "存在未解决的阻断项，无法通过关口评审。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 评审记录 ID ← `review_actions.id` |
| `project_id` | string | 项目 ID ← `review_actions.project_id` |
| `gate` | string\|null | 关口类型 ← `review_actions.gate` |
| `entity_type` | string | 实体类型 ← `review_actions.entity_type` |
| `entity_id` | string | 实体 ID ← `review_actions.entity_id` |
| `entity_version` | integer | 实体版本 ← `review_actions.entity_version` |
| `action` | string | 评审动作 ← `review_actions.action` |
| `reviewer_id` | string | 评审者 ID ← `review_actions.reviewer_id` |
| `reason` | string | 评审理由 ← `review_actions.reason` |
| `follow_up` | object\|null | 跟进信息 ← `review_actions.follow_up_json` |
| `created_at` | string | 创建时间 ← `review_actions.created_at` |

`modify` 必须携带修改内容并创建新版本；`uncertain` 保持待核实并创建复查项；任何未处理阻断项都禁止建立已确认基线。AI 身份无权调用确认端点。

### 9.12 冲突解决

#### POST /api/conflicts/:id/resolve

记录选项、决策、理由、责任人、适用范围和失效条件。

**请求示例**：

```json
{
  "decision": {
    "question": "数据隐私与实时监控的权衡",
    "selected_option_id": "OPT_002",
    "rationale": "采用差分隐私方案，在保证数据可用性的同时满足合规要求",
    "review_trigger": "当隐私法规更新时重新评估"
  },
  "owner_id": "USR_001",
  "applicable_scope": "所有患者数据处理模块",
  "expiry_condition": "法规变更或技术方案重大升级"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `decision.question` | string | 是 | 决策问题 ← `decisions.question` |
| `decision.selected_option_id` | string\|null | 否 | 选中的选项 ID ← `decisions.selected_option_id` |
| `decision.rationale` | string\|null | 否 | 决策理由 ← `decisions.rationale` |
| `decision.review_trigger` | string\|null | 否 | 复审触发条件 ← `decisions.review_trigger` |
| `owner_id` | string\|null | 否 | 责任人 ID（用于冲突和决策） |
| `applicable_scope` | string\|null | 否 | 适用范围 |
| `expiry_condition` | string\|null | 否 | 失效条件 |

**响应示例**：

```json
{
  "data": {
    "conflict_id": "CF_...",
    "conflict_status": "resolved",
    "decision_id": "DEC_...",
    "decision_status": "decided",
    "selected_option_id": "OPT_002",
    "rationale": "采用差分隐私方案，在保证数据可用性的同时满足合规要求",
    "decided_by": "USR_001",
    "decided_at": "2026-07-01T17:10:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：decision.question。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `conflict_id` | string | 冲突 ID ← `conflicts.id` |
| `conflict_status` | string | 冲突更新后状态 ← `conflicts.status` |
| `decision_id` | string | 决策 ID ← `decisions.id` |
| `decision_status` | string | 决策状态 ← `decisions.status` |
| `selected_option_id` | string\|null | 选中的选项 ID ← `decisions.selected_option_id` |
| `rationale` | string\|null | 决策理由 ← `decisions.rationale` |
| `decided_by` | string\|null | 决策者 ID ← `decisions.decided_by` |
| `decided_at` | string\|null | 决策时间 ← `decisions.decided_at` |

`GET /api/projects/:id/conflicts`：按状态、版本和认识类型查询冲突列表。

#### GET /api/conflicts/:id

返回单个冲突的双方观点、候选方案和当前决策引用。

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id/project_id/statement/severity/status/version/created_at/updated_at` | object fields | 冲突摘要 ← `conflicts` |
| `sides` | array | 双方或多方观点；每项含 `label/statement/stance/evidence_link_ids` |
| `options` | array | 候选方案；每项含 `description/benefits/costs/risks/reversibility/status` |
| `current_decision_id` | string\|null | 当前已形成的决策 ID；未决时为 null |

冲突列表只用于摘要和筛选；冲突决策页必须读取详情端点后才能显示方案比较表和提交 `selected_option_id`。

Requirement 写契约至少包含：`requirement_key`、`statement`、`requirement_type`、`provenance`、`driver_ids`、`horizon`、`scope_disposition`、`commitment`、`stability`、`priority`、`valid_from`、`valid_until`、`activation_trigger`、`deactivation_trigger`、`volatility_drivers`、`migration_strategy`、`reversibility`、`owner_id` 和可选 `supersedes_requirement_id`。Evidence 和 Acceptance 使用关系资源维护，不以客户端提交的自由 JSON 替代。

## 10. 基线与报告

### 10.0 查询基线列表

`GET /api/projects/:id/baselines`：返回项目基线历史，支持 `limit/cursor/status`。

前端范围确认页用该端点展示历史版本和当前版本，不再只依赖 `GET /api/projects/:id.current_baseline`。列表项为 `Baseline`：`id/project_id/baseline_version/status/data_hash/items/version/approved_by/approved_at/created_at`。

### 10.1 创建基线

`POST /api/projects/:id/baselines`：从指定实体版本创建候选基线并运行范围门禁。

**请求示例**：

```json
{
  "entity_versions": {
    "outcomes": ["OUT_001@2", "OUT_002@1"],
    "requirements": ["REQ_001@3", "REQ_002@1"],
    "drivers": ["DRV_001@2", "DRV_002@1"]
  },
  "expected_project_version": 9
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `entity_versions` | object | 是 | 按实体类型分组的版本列表，格式 `{entity_id}@{version}` |
| `expected_project_version` | integer | 是 | 项目版本号，用于并发控制 |

**响应示例**：

```json
{
  "data": {
    "id": "BL_...",
    "project_id": "PRJ_...",
    "baseline_version": 1,
    "status": "draft",
    "data_hash": "sha256:...",
    "items": [
      { "entity_type": "outcome", "entity_id": "OUT_001", "entity_version": 2 },
      { "entity_type": "outcome", "entity_id": "OUT_002", "entity_version": 1 },
      { "entity_type": "requirement", "entity_id": "REQ_001", "entity_version": 3 },
      { "entity_type": "requirement", "entity_id": "REQ_002", "entity_version": 1 },
      { "entity_type": "driver", "entity_id": "DRV_001", "entity_version": 2 },
      { "entity_type": "driver", "entity_id": "DRV_002", "entity_version": 1 }
    ],
    "version": 1,
    "created_at": "2026-07-01T17:15:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：entity_versions。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 基线 ID ← `baselines.id` |
| `project_id` | string | 项目 ID ← `baselines.project_id` |
| `baseline_version` | integer | 基线版本号 ← `baselines.baseline_version` |
| `status` | string | 基线状态 ← `baselines.status` |
| `data_hash` | string | 数据哈希 ← `baselines.data_hash` |
| `items` | array | 基线包含的实体版本列表 ← `baseline_items` |
| `version` | integer | 乐观锁版本 ← `baselines.version` |
| `created_at` | string | 创建时间 ← `baselines.created_at` |

### 10.2 批准基线

`POST /api/baselines/:id/approve`：Reviewer/Owner 批准，需 `expected_version`。

**请求示例**：

```json
{
  "expected_version": 1
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `expected_version` | integer | 是 | 基线乐观锁版本号 |

**响应示例**：

```json
{
  "data": {
    "id": "BL_...",
    "project_id": "PRJ_...",
    "baseline_version": 1,
    "status": "approved",
    "approved_by": "USR_001",
    "approved_at": "2026-07-01T17:20:00Z",
    "data_hash": "sha256:...",
    "version": 2,
    "created_at": "2026-07-01T17:15:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 基线 ID ← `baselines.id` |
| `project_id` | string | 项目 ID ← `baselines.project_id` |
| `baseline_version` | integer | 基线版本号 ← `baselines.baseline_version` |
| `status` | string | 基线状态 ← `baselines.status` |
| `approved_by` | string\|null | 批准者 ID ← `baselines.approved_by` |
| `approved_at` | string\|null | 批准时间 ← `baselines.approved_at` |
| `data_hash` | string | 数据哈希 ← `baselines.data_hash` |
| `version` | integer | 更新后的乐观锁版本 ← `baselines.version` |
| `created_at` | string | 创建时间 ← `baselines.created_at` |

**并发**：需携带 `expected_version` 字段。版本不一致返回 `409 VERSION_CONFLICT`。

### 10.3 编译报告

`POST /api/projects/:id/reports`：从已确认基线编译报告，返回 `202` Job。

**请求示例**：

```json
{
  "baseline_id": "BL_...",
  "audience": "executive",
  "language": "zh-CN",
  "template_id": "exec-summary",
  "template_version": "1.0.0"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `baseline_id` | string | 是 | 已批准基线 ID ← `report_snapshots.baseline_id` |
| `audience` | string | 是 | 目标受众 ← `report_snapshots.audience` |
| `language` | string | 是 | 语言 ← `report_snapshots.language` |
| `template_id` | string | 是 | 模板 ID ← `report_snapshots.template_id` |
| `template_version` | string | 是 | 模板版本 ← `report_snapshots.template_version` |

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

报告快照通过轮询获取（result 类型：`report_snapshot`）。原始响应字段（通过 Job 结果返回，不在 202 响应中）：`report_id`、`status`、`created_at`。

**授权**：需 `编译报告草稿` 能力（见 §3 身份与能力表）；触发真实 AI 编译需有效 `agreement_consents` 记录（未同意返回 `403 AGREEMENT_REQUIRED`，见 §2.2）。

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "TOKEN_BUDGET_EXCEEDED",
    "message": "项目 Token 预算不足，无法发起编译。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**（通过 Job 结果返回，不在 202 响应中）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `report_id` | string | 报告 ID ← `report_snapshots.id` |
| `job_id` | string | 编译作业 ID ← `ai_jobs.id` |
| `status` | string | 报告状态 ← `report_snapshots.status` |
| `created_at` | string | 创建时间 ← `report_snapshots.generated_at` |

编译请求必须指定 `baseline_id`、受众、语言和模板版本。响应元数据至少含 `data_hash`、`template_version`、`generated_at`、`domain_profile_id`、`domain_profile_version`、领域配置版本、`report_input_schema_hash`、`compiler_version`；若使用模型组织语言，还必须记录 `prompt_versions` 和 `model_versions`，未使用时保存空集合而不是伪造版本。阻断冲突、引用失效或内容块缺失返回 `REPORT_GATE_FAILED`，仍可保留草稿但不能发布。

### 10.3a 查询报告列表

`GET /api/projects/:id/reports`：返回项目报告快照历史，支持 `limit/cursor/status`。

分析报告页用该端点恢复版本列表、当前报告状态和下载入口；单个报告详情仍通过 `GET /api/reports/:id` 查询。列表项为 `ReportSnapshot`，包含版本、基线、模板、输入哈希、门禁缺陷、文件哈希和发布状态。

### 10.4 查询报告

`GET /api/reports/:id`：状态、章节覆盖、门禁缺陷、版本元数据和下载能力。

**响应示例**：

```json
{
  "data": {
    "id": "RPT_...",
    "project_id": "PRJ_...",
    "report_version": 1,
    "baseline_id": "BL_...",
    "status": "ready",
    "audience": "executive",
    "language": "zh-CN",
    "data_hash": "sha256:...",
    "template_id": "exec-summary",
    "template_version": "1.0.0",
    "core_schema_version": "1.0.0",
    "report_input_schema_hash": "sha256:...",
    "compiler_version": "compiler-v1.0.0",
    "domain_profile_id": "DP_...",
    "domain_profile_version": 2,
    "domain_pack_versions": ["software-delivery@1.0.0"],
    "prompt_versions": ["report-prompt-v2"],
    "model_versions": ["deepseek-v4-pro"],
    "chapter_coverage": {
      "executive_summary": {
        "status": "complete",
        "required": true,
        "source_count": 8,
        "missing_reason": null
      },
      "requirements": {
        "status": "complete",
        "required": true,
        "source_count": 14,
        "missing_reason": null
      },
      "risks": {
        "status": "complete",
        "required": true,
        "source_count": 5,
        "missing_reason": null
      },
      "decisions": {
        "status": "partial",
        "required": true,
        "source_count": 2,
        "missing_reason": "仍有一个非阻断冲突未形成最终决策"
      }
    },
    "gate_defects": [],
    "file_blob_id": "BLB_...",
    "file_sha256": "sha256:...",
    "file_size": 204800,
    "generated_at": "2026-07-01T17:30:00Z",
    "released_by": null,
    "released_at": null,
    "supersedes_report_id": null
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 报告 ID ← `report_snapshots.id` |
| `project_id` | string | 项目 ID ← `report_snapshots.project_id` |
| `report_version` | integer | 报告版本号 ← `report_snapshots.report_version` |
| `baseline_id` | string | 基线 ID ← `report_snapshots.baseline_id` |
| `status` | string | 报告状态 ← `report_snapshots.status` |
| `audience` | string | 目标受众 ← `report_snapshots.audience` |
| `language` | string | 语言 ← `report_snapshots.language` |
| `data_hash` | string | 数据哈希 ← `report_snapshots.data_hash` |
| `template_id` | string | 模板 ID ← `report_snapshots.template_id` |
| `template_version` | string | 模板版本 ← `report_snapshots.template_version` |
| `core_schema_version` | string | 核心 Schema 版本 ← `report_snapshots.core_schema_version` |
| `report_input_schema_hash` | string | 输入 Schema 哈希 ← `report_snapshots.report_input_schema_hash` |
| `compiler_version` | string | 编译器版本 ← `report_snapshots.compiler_version` |
| `domain_profile_id` | string | 领域画像 ID ← `report_snapshots.domain_profile_id` |
| `domain_profile_version` | integer | 画像版本 ← `report_snapshots.domain_profile_version` |
| `domain_pack_versions` | array | 领域包版本列表 ← `report_snapshots.domain_pack_versions_json` |
| `prompt_versions` | array | Prompt 版本列表 ← `report_snapshots.prompt_versions_json` |
| `model_versions` | array | 模型版本列表 ← `report_snapshots.model_versions_json` |
| `chapter_coverage` | object | 章节/内容块覆盖情况：键为模板章节或内容块 ID，值为 `status/required/source_count/missing_reason` 固定结构（计算字段） |
| `gate_defects` | array | 门禁缺陷列表：`gate_code/severity/blocking/message/entity_refs/resolution_hint` ← `report_gate_results` |
| `file_blob_id` | string\|null | 文件存储对象 ID ← `report_snapshots.file_blob_id` |
| `file_sha256` | string\|null | 文件哈希 ← `report_snapshots.file_sha256` |
| `file_size` | integer\|null | 文件大小（计算字段，来自 `blobs.byte_size`） |
| `generated_at` | string | 生成时间 ← `report_snapshots.generated_at` |
| `released_by` | string\|null | 发布者 ID ← `report_snapshots.released_by` |
| `released_at` | string\|null | 发布时间 ← `report_snapshots.released_at` |
| `supersedes_report_id` | string\|null | 被替代的报告 ID ← `report_snapshots.supersedes_report_id` |

### 10.5 发布报告

`POST /api/reports/:id/releases`：Reviewer/Owner 执行发布门禁并冻结 PDF 快照。

**请求示例**：

```json
{
  "expected_version": 1
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `expected_version` | integer | 是 | 报告乐观锁版本号 |

**响应示例**：

```json
{
  "data": {
    "id": "RPT_...",
    "project_id": "PRJ_...",
    "report_version": 1,
    "status": "released",
    "file_sha256": "sha256:...",
    "released_by": "USR_001",
    "released_at": "2026-07-01T17:35:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `发布报告` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回 `409 VERSION_CONFLICT`。

**错误示例**：
```json
{
  "error": {
    "code": "BLOCKING_CONFLICT",
    "message": "存在未解决的阻断项，无法发布报告。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 报告 ID ← `report_snapshots.id` |
| `project_id` | string | 项目 ID ← `report_snapshots.project_id` |
| `report_version` | integer | 报告版本号 ← `report_snapshots.report_version` |
| `status` | string | 报告状态 ← `report_snapshots.status` |
| `file_sha256` | string\|null | 文件哈希 ← `report_snapshots.file_sha256` |
| `released_by` | string\|null | 发布者 ID ← `report_snapshots.released_by` |
| `released_at` | string\|null | 发布时间 ← `report_snapshots.released_at` |

### 10.6 下载报告

`GET /api/reports/:id/file`：具有导出能力时下载发布文件。

**响应**：二进制流，`Content-Type: application/pdf`，`Content-Disposition: attachment; filename="report-{report_version}.pdf"`。

报告未发布时返回 `404 RESOURCE_NOT_FOUND`；当前用户无导出能力时返回 `403 FORBIDDEN`。

`GET /api/projects/:id/reports/:reportId/download`：项目作用域的等价下载端点，行为与 `GET /api/reports/:id/file` 一致，额外校验 `:id` 与 `:reportId` 的归属关系（`report_snapshots.project_id` 必须等于路径中的项目 ID），以及当前用户在该项目上的成员资格与 `下载报告` 能力（Owner/Reviewer/Exporter）。

**响应**（`302 Found`）：重定向到临时下载 URL（24 小时有效，与 §14.2 服务端临时导出文件默认期一致），响应头携带 `Location: <临时签名 URL>`；或 `200 OK` 直接返回 PDF 二进制流（同 `GET /api/reports/:id/file`）。客户端可在两种模式中由实现选择，文档不强制。

**错误**：

- `404 RESOURCE_NOT_FOUND`：项目或报告不存在、报告未发布、或报告不属于该项目。
- `403 FORBIDDEN`：当前用户无 `下载报告` 能力或非项目成员。

### 10.7 报告状态机

发布采用可恢复状态机，状态转换规则如下：

1. **`draft`**：报告已创建，待编译
2. **`gate_failed`**：编译门禁失败，保留草稿供修正。可从 `draft` 进入
3. **`rendering`**：正在编译渲染中。可从 `draft`（重试）或 `gate_failed`（修正后重试）进入
4. **`staged`**：临时文件已写入、fsync 完成、哈希已登记。可从 `rendering` 进入
5. **`ready`**：文件已就绪但尚未通过发布门禁，此时可调用 `POST /api/reports/:id/releases` 执行发布门禁。可从 `staged` 进入
6. **`released`**：发布门禁通过，PDF 快照已冻结。可从 `ready` 进入
7. **`publish_failed`**：可从 `rendering`（渲染失败）或 `ready`（发布门禁失败或文件写入失败）进入
8. **`superseded`**：被新版本替代。可从 `released` 进入

**完整路径**：`draft → gate_failed（失败）| rendering → staged → ready → released`

**注意事项**：

- 文件系统与 SQLite 不能共享事务。发布时先渲染临时文件并 `fsync` → 计算哈希并登记 `staged` blob → 原子重命名到最终位置 → 数据库短事务校验门禁并转 `released`。任一步失败进入 `publish_failed`；恢复任务根据临时文件、blob 哈希和数据库状态重试或清理，绝不把缺失文件的记录标为 `released`。
- `released` 要求 `file_blob_id/file_sha256`、全部门禁、确认身份和时间齐全。
- 已发布快照不可修改。
- 崩溃恢复检查 blob 实体和文件哈希；文件缺失时转 `publish_failed`，绝不显示已发布。

## 11. 预演与真实变化

### 11.1 创建变化预演

`POST /api/projects/:id/change-previews`：创建隔离预演，只读正式基线，不改变项目状态。

**请求示例**：

```json
{
  "baseline_id": "BL_...",
  "scenario": {
    "type": "requirement_change",
    "description": "新增需求：支持视频问诊功能",
    "affected_entities": [
      { "entity_type": "requirement", "entity_id": "REQ_..." }
    ],
    "proposed_changes": {
      "new_requirements": [
        {
          "requirement_key": "REQ-VIDEO-001",
          "statement": "系统应支持医生与患者之间的实时视频通话",
          "requirement_type": "functional",
          "provenance": "proposed",
          "horizon": "next",
          "commitment": "conditional"
        }
      ]
    }
  }
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `baseline_id` | string | 是 | 基于的基线 ID ← `change_previews.baseline_id` |
| `scenario` | object | 是 | 变化场景描述 ← `change_previews.scenario_json` |

**响应示例**：

```json
{
  "data": {
    "id": "CPV_...",
    "project_id": "PRJ_...",
    "baseline_id": "BL_...",
    "status": "draft",
    "created_by": "USR_001",
    "created_at": "2026-07-01T17:40:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 预演 ID ← `change_previews.id` |
| `project_id` | string | 项目 ID ← `change_previews.project_id` |
| `baseline_id` | string | 基线 ID ← `change_previews.baseline_id` |
| `status` | string | 预演状态 ← `change_previews.status` |
| `created_by` | string | 创建者 ID ← `change_previews.created_by` |
| `created_at` | string | 创建时间 ← `change_previews.created_at` |

### 11.2 查看预演影响

`GET /api/change-previews/:id/impact`：返回影响路径、建议和未决项。

**响应示例**：

```json
{
  "data": {
    "preview_id": "CPV_...",
    "status": "ready",
    "impacts": [
      {
        "id": "CIM_001",
        "entity_type": "requirement",
        "entity_id": "REQ_002",
        "impact_type": "conflict",
        "severity": "high",
        "recommended_action": "需要重新评估性能需求",
        "required_stage": "scope",
        "rationale": "视频功能可能影响现有问诊响应时间需求",
        "status": "candidate"
      },
      {
        "id": "CIM_002",
        "entity_type": "outcome",
        "entity_id": "OUT_001",
        "impact_type": "modification",
        "severity": "medium",
        "recommended_action": "更新成功指标以包含视频功能",
        "required_stage": "outcome",
        "rationale": "等待时间指标需要区分文字和视频问诊",
        "status": "candidate"
      }
    ],
    "unresolved_items": [
      {
        "type": "unknown",
        "description": "视频问诊的带宽要求需要进一步调研"
      }
    ],
    "suggested_stages": ["outcome", "scope"],
    "created_at": "2026-07-01T17:40:00Z",
    "expires_at": "2026-07-08T17:40:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `preview_id` | string | 预演 ID ← `change_previews.id` |
| `status` | string | 预演状态 ← `change_previews.status` |
| `impacts` | array | 影响列表 ← `change_impacts`（`preview_id` 关联） |
| `impacts[].id` | string | 影响项 ID ← `change_impacts.id` |
| `impacts[].entity_type` | string | 受影响实体类型 ← `change_impacts.entity_type` |
| `impacts[].entity_id` | string | 受影响实体 ID ← `change_impacts.entity_id` |
| `impacts[].impact_type` | string | 影响类型 ← `change_impacts.impact_type` |
| `impacts[].severity` | string | 严重程度 ← `change_impacts.severity` |
| `impacts[].recommended_action` | string\|null | 建议行动 ← `change_impacts.recommended_action` |
| `impacts[].required_stage` | string\|null | 需要重开的阶段 ← `change_impacts.required_stage` |
| `impacts[].rationale` | string | 影响理由 ← `change_impacts.rationale` |
| `unresolved_items` | array | 未决项列表（计算字段） |
| `suggested_stages` | array | 建议重开的阶段集合（计算字段） |
| `created_at` | string | 创建时间 ← `change_previews.created_at` |
| `expires_at` | string\|null | 过期时间 ← `change_previews.expires_at` |

### 11.2a 查询真实变化列表

`GET /api/projects/:id/changes`：返回项目下真实变化历史，支持 `limit/cursor/status`。预演不出现在该列表；预演仍通过 `change-previews` 端点单独查看。

列表项为 `Change`：`id/project_id/source_type/description/trigger_type/occurred_at/severity/source_id/status/version/created_at/updated_at`。变更预演页、真实变化详情页和终态历史页必须用该端点恢复完整历史，不得只展示路由里刚创建的单条变化。

### 11.3 登记真实变化

`POST /api/projects/:id/changes`：登记已发生或已确认将发生的真实变化。

**请求示例**：

```json
{
  "source_type": "regulatory",
  "description": "《在线诊疗管理办法》修订版发布，要求所有在线诊疗平台增加实名认证和电子签名功能",
  "trigger_type": "external_event",
  "occurred_at": "2026-06-30T00:00:00Z",
  "severity": "high",
  "source_id": "SRC_010"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `source_type` | string | 是 | 变化来源类型 ← `changes.source_type` |
| `description` | string | 是 | 变化描述 ← `changes.description` |
| `trigger_type` | string\|null | 否 | 触发类型 ← `changes.trigger_type` |
| `occurred_at` | string\|null | 否 | 发生时间 ← `changes.occurred_at` |
| `severity` | string | 是 | 严重程度：`low` / `medium` / `high` / `critical` ← `changes.severity` |
| `source_id` | string\|null | 否 | 关联来源 ID ← `changes.source_id` |

**响应示例**：

```json
{
  "data": {
    "id": "CHG_...",
    "project_id": "PRJ_...",
    "source_type": "regulatory",
    "description": "《在线诊疗管理办法》修订版发布，要求所有在线诊疗平台增加实名认证和电子签名功能",
    "trigger_type": "external_event",
    "occurred_at": "2026-06-30T00:00:00Z",
    "severity": "high",
    "status": "draft",
    "version": 1,
    "created_at": "2026-07-01T17:45:00Z",
    "updated_at": "2026-07-01T17:45:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：无需 `expected_version`。

**错误示例**：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "缺少必填字段：source_type、description、severity。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 变化 ID ← `changes.id` |
| `project_id` | string | 项目 ID ← `changes.project_id` |
| `source_type` | string | 变化来源类型 ← `changes.source_type` |
| `description` | string | 变化描述 ← `changes.description` |
| `trigger_type` | string\|null | 触发类型 ← `changes.trigger_type` |
| `occurred_at` | string\|null | 发生时间 ← `changes.occurred_at` |
| `severity` | string | 严重程度 ← `changes.severity` |
| `status` | string | 变化状态 ← `changes.status` |
| `version` | integer | 乐观锁版本 ← `changes.version` |
| `created_at` | string | 创建时间 ← `changes.created_at` |
| `updated_at` | string | 更新时间 ← `changes.updated_at` |

### 11.4 查看变化影响

`GET /api/changes/:id/impact`：返回受影响实体、建议重开阶段和再验证项。

**响应示例**：

```json
{
  "data": {
    "change_id": "CHG_...",
    "status": "analyzing",
    "impacts": [
      {
        "id": "CIM_003",
        "entity_type": "requirement",
        "entity_id": "REQ_005",
        "impact_type": "new_requirement",
        "severity": "critical",
        "recommended_action": "新增实名认证和电子签名相关需求",
        "required_stage": "scope",
        "rationale": "法规明确要求实名认证和电子签名",
        "status": "candidate"
      }
    ],
    "suggested_stages": ["outcome", "scope", "report"],
    "created_at": "2026-07-01T17:45:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `change_id` | string | 变化 ID ← `changes.id` |
| `status` | string | 变化状态 ← `changes.status` |
| `impacts` | array | 影响列表 ← `change_impacts`（`change_id` 关联） |
| `impacts[].id` | string | 影响项 ID ← `change_impacts.id` |
| `impacts[].entity_type` | string | 受影响实体类型 ← `change_impacts.entity_type` |
| `impacts[].entity_id` | string | 受影响实体 ID ← `change_impacts.entity_id` |
| `impacts[].impact_type` | string | 影响类型 ← `change_impacts.impact_type` |
| `impacts[].severity` | string | 严重程度 ← `change_impacts.severity` |
| `impacts[].recommended_action` | string\|null | 建议行动 ← `change_impacts.recommended_action` |
| `impacts[].required_stage` | string\|null | 需要重开的阶段 ← `change_impacts.required_stage` |
| `impacts[].rationale` | string | 影响理由 ← `change_impacts.rationale` |
| `suggested_stages` | array | 建议重开的阶段集合（计算字段） |
| `created_at` | string | 创建时间 ← `changes.created_at` |

### 11.5 确认变化

`POST /api/changes/:id/confirm`：责任人确认变化并将项目转入 `Changing`，原子创建阶段重开任务。

**请求示例**：

```json
{
  "expected_version": 1
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `expected_version` | integer | 是 | 变化记录乐观锁版本号 |

**响应示例**：

```json
{
  "data": {
    "id": "CHG_...",
    "project_id": "PRJ_...",
    "status": "confirmed",
    "confirmed_by": "USR_001",
    "confirmed_at": "2026-07-01T17:50:00Z",
    "project_status": "Changing",
    "reopened_stages": ["outcome", "scope"],
    "reopen_tasks": [
      { "task_id": "TSK_001", "stage": "outcome", "reason": "法规变化影响成果定义" },
      { "task_id": "TSK_002", "stage": "scope", "reason": "需要新增实名认证和电子签名需求" }
    ]
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回 `409 VERSION_CONFLICT`。

**错误示例**：
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "变化记录已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 变化 ID ← `changes.id` |
| `project_id` | string | 项目 ID ← `changes.project_id` |
| `status` | string | 变化状态 ← `changes.status` |
| `confirmed_by` | string\|null | 确认者 ID ← `changes.confirmed_by` |
| `confirmed_at` | string\|null | 确认时间 ← `changes.confirmed_at` |
| `project_status` | string | 项目更新后的状态（计算字段） |
| `reopened_stages` | array | 需要重开的阶段列表（计算字段） |
| `reopen_tasks` | array | 阶段重开任务列表（计算字段） |

### 11.6 撤回变化

`POST /api/changes/:id/withdraw`：撤回尚未进入新基线的错误变化记录，必须提交理由并保留撤回人、时间和审计；已进入新基线时返回 `409`。

**请求示例**：

```json
{
  "reason": "法规修订版实际未包含预期的强制要求，经核实后撤回",
  "expected_version": 2
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `reason` | string | 是 | 撤回理由 ← `changes.withdrawal_reason` |
| `expected_version` | integer | 是 | 变化记录乐观锁版本号 |

**响应示例**：

```json
{
  "data": {
    "id": "CHG_...",
    "project_id": "PRJ_...",
    "status": "withdrawn",
    "withdrawn_by": "USR_001",
    "withdrawn_at": "2026-07-01T17:55:00Z",
    "withdrawal_reason": "法规修订版实际未包含预期的强制要求，经核实后撤回"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**授权**：需 `编辑内容/发起分析` 能力（见 §3 身份与能力表）

**幂等**：需携带 `Idempotency-Key` 请求头。重复请求返回与首次成功相同的 HTTP 状态与响应体，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

**并发**：需携带 `expected_version` 字段。版本不一致返回 `409 VERSION_CONFLICT`。

**错误示例**：
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "变化记录已被更新，请刷新后重试。",
    "retryable": false,
    "request_id": "REQ_..."
  }
}
```

**响应字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | 变化 ID ← `changes.id` |
| `project_id` | string | 项目 ID ← `changes.project_id` |
| `status` | string | 变化状态 ← `changes.status` |
| `withdrawn_by` | string\|null | 撤回者 ID ← `changes.withdrawn_by` |
| `withdrawn_at` | string\|null | 撤回时间 ← `changes.withdrawn_at` |
| `withdrawal_reason` | string\|null | 撤回理由 ← `changes.withdrawal_reason` |

真实变化不会固定返回访谈。服务端根据影响类型提出阶段集合，责任人可扩大但不能跳过被规则判定为必要的阶段。完成后创建新基线和报告版本，不覆盖历史。

## 12A. 表达训练

表达训练是试验模式（P2），训练用户主动发现信息缺口、提出有效问题并形成准确摘要。训练数据必须与真实项目隔离，AI 扮演角色时只使用案例允许披露的信息（对齐 PRD §7、ADD §11.4、§12.3）。

当前实现状态：训练案例列表、训练尝试、训练问题索引、训练总结哈希、训练反馈和训练回合恢复表已经存在；前端已有案例选择、左右分屏练习、服务端消息恢复和反馈页。`postTrainingQuestion` 返回的 `202 + job_id` 会驱动 DeepSeek 角色回答，`postTrainingSummary` 会生成教练反馈。真实实现必须按 [08-expression-training-development-plan.md](./08-expression-training-development-plan.md) 将隐藏案例信息留在后端，并把 `training_response / training_feedback` 接入 AgentRun、SkillRun、AiRun 审计链。

状态机：`not_started → interviewing → summarizing → feedback_ready → retrying/completed`。训练状态不得映射为正式项目状态，也不得产生正式 Fact、Requirement、Decision 或 ReviewAction；`completed` 不代表权威能力认证。

### 12A.1 列出训练案例

`GET /api/training-cases`：列出可用训练案例。

**响应**（`200`）：

```json
{
  "data": [
    {
      "id": "TC_...",
      "name": "软件项目需求澄清",
      "category": "software",
      "difficulty_levels": ["easy", "medium"],
      "latest_version": "1.0.0",
      "status": "active"
    }
  ],
  "meta": { "request_id": "REQ_...", "cursor": null, "has_more": false }
}
```

### 12A.2 获取版本化案例

`GET /api/training-cases/:caseId/versions/:version`：返回训练案例的公开版本详情。完整披露规则、隐藏事实和答案要点只允许后端 Training Runtime 读取，不返回给浏览器。

**响应**（`200`）：

```json
{
  "data": {
    "id": "TC_...",
    "version": "1.0.0",
    "name": "软件项目需求澄清",
    "public_brief": {
      "role_label": "业务方",
      "practice_goal": "练习围绕目标、场景、范围和完成标准追问",
      "visible_constraints": ["角色只回答你问到的信息"]
    },
    "evaluation_dimensions": ["目标澄清", "对象与场景", "范围边界", "完成标准"],
    "status": "active"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：该响应不得包含 `answer_key`、完整 `disclosure_rules`、隐藏事实、评分触发规则或可反推出正确答案的私有字段。当前实现若仍返回这些字段，应作为表达训练真实链路前的阻断修复项处理。

**错误**：`TRAINING_CASE_NOT_FOUND`（`404`）。

### 12A.3 开始训练

`POST /api/training-attempts`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "case_id": "TC_...",
  "case_version": "1.0.0",
  "difficulty": "medium"
}
```

**请求字段**：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `case_id` | string | 是 | 训练案例 ID ← `training_attempts.case_id` |
| `case_version` | string | 是 | 案例版本 ← `training_attempts.case_version` |
| `difficulty` | string\|null | 否 | 难度等级 ← `training_attempts.difficulty` |

**授权**：`actor_kind=guest` 或 `actor_kind=user`；触发真实 AI 扮演需有效协议同意（未同意返回 `403 AGREEMENT_REQUIRED`）。

**响应**（`201`）：

```json
{
  "data": {
    "attempt_id": "TA_...",
    "status": "interviewing"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：案例损坏时阻断，不拼接其他案例答案；训练数据与真实项目隔离。

### 12A.4 提交追问

`POST /api/training-attempts/:id/questions`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "question": "这个系统的目标用户是谁？"
}
```

**授权**：`actor_kind=guest` 或 `actor_kind=user`；触发真实 AI 回应需有效协议同意。

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

训练回应通过轮询获取（result 类型：`training_response`）。原始响应字段（通过 Job 结果返回，不在 202 响应中）：`response`、`disclosure_rule_hit`。

**异步链路**：返回 `202 + job_id`，由 JobWorker 通过 TrainingJobExecutor 调用 DeepSeek 生成角色回答；前端轮询 `/api/v1/ai-jobs/{job_id}` 获取 `training_response` 结果。

**约束**：AI 按案例扮演客户、老师、同事或业务方；命中规则时披露允许信息，否则角色按案例回应；不记录问题正文到产品埋点（`training_question_asked` 事件只记 `question_index`、`disclosure_rule_hit`）。

### 12A.5 提交总结

`POST /api/training-attempts/:id/summary`，需 `Idempotency-Key`。

**请求示例**：

```json
{
  "summary": "本系统面向中小设计团队，核心场景是快速生成海报……"
}
```

**响应**（`202`）：

```json
{
  "data": {
    "job_id": "JOB_...",
    "status": "queued",
    "status_url": "/api/v1/ai-jobs/JOB_..."
  },
  "meta": { "request_id": "REQ_..." }
}
```

**异步链路**：返回 `202 + job_id`，由 JobWorker 调用 DeepSeek 生成训练反馈；`getTrainingAttempt` 状态由 `summarizing` 流转为 `feedback_ready` 后，前端方可调用 `GET /api/training-attempts/:id/feedback`。

**约束**：只存哈希（`summary_version`）；允许返回继续追问，不伪造缺失答案；`training_summary_submitted` 事件不记录正文。

### 12A.5a 获取训练尝试状态

`GET /api/training-attempts/:id`：返回训练尝试当前状态，用于提交总结后的恢复、轮询反馈是否就绪和避免前端自行推断状态。

**响应**（`200`）：

```json
{
  "data": {
    "attempt_id": "TA_...",
    "status": "feedback_ready",
    "case_id": "TC_...",
    "case_version": "1.0.0",
    "started_at": "2026-07-01T09:00:00Z",
    "completed_at": null
  },
  "meta": { "request_id": "REQ_..." }
}
```

提交总结后前端轮询该端点；只有 `status=feedback_ready` 后才调用 `GET /api/training-attempts/:id/feedback`。

### 12A.6 获取反馈

`GET /api/training-attempts/:id/feedback`：返回覆盖结果、遗漏和改进建议。

**响应**（`200`）：

```json
{
  "data": {
    "coverage_score": 0.72,
    "missing_dimensions": ["约束与风险", "验证"],
    "improvement_suggestions": [
      "应追问时间限制和资源约束",
      "可提出可观察的完成条件"
    ],
    "dimension_breakdown": [
      {
        "dimension": "目标与用户",
        "status": "covered",
        "evidence": "用户追问了目标用户和使用场景",
        "comment": "覆盖充分"
      },
      {
        "dimension": "约束与风险",
        "status": "missing",
        "evidence": "未追问时间、预算或技术限制",
        "comment": "会导致方案边界不清"
      }
    ],
    "improvement_examples": [
      {
        "before": "你想做哪些功能？",
        "after": "在时间、预算或平台限制下，哪些功能必须第一版完成？",
        "reason": "把开放追问改成带约束的范围澄清"
      }
    ]
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：评分由确定性覆盖检查和受约束的 AI 反馈共同形成；必须展示评分依据、遗漏项、逐维覆盖状态和改进示例；AI 反馈失败时仍展示确定性覆盖结果；分数只用于本次训练反馈，不宣称是权威能力认证。

### 12A.7 重新练习

`POST /api/training-attempts/:id/retry`，需 `Idempotency-Key`。

**响应**（`201`）：

```json
{
  "data": {
    "attempt_id": "TA_...",
    "status": "interviewing"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：新建后续 Attempt，保留旧反馈；不覆盖旧分数或写入真实项目。

### 12A.8 完成训练

`POST /api/training-attempts/:id/complete`，需 `Idempotency-Key`。

**响应**（`200`）：

```json
{
  "data": {
    "attempt_id": "TA_...",
    "status": "completed",
    "completed_at": "2026-07-01T10:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：反馈可见后可完成；`completed` 不代表权威能力认证。

## 12B. 产品埋点事件入口与指标

产品埋点用于验证产品流程和假设，不作为业务事实、需求证据、员工绩效或训练认证依据。业务审计日志与产品分析事件必须分开存储和授权（对齐 PRD §12.5、ADD §18.3）。

### 12B.1 批量或单条接收事件

`POST /api/events`：批量或单条接收事件。

**请求示例**：

```json
{
  "events": [
    {
      "event_id": "EVT_...",
      "event_name": "question_interaction",
      "event_schema_version": "1.0.0",
      "occurred_at": "2026-07-01T08:00:00Z",
      "environment": "pilot",
      "app_version": "1.0.0",
      "mode": "quick",
      "source_kind": "custom",
      "analytics_session_id": "AS_demo_001",
      "actor_key": null,
      "stage": "clarifying",
      "experiment_id": null,
      "attributes": {
        "question_template_id": "QT_target_user",
        "action": "answered",
        "elapsed_ms": 4200
      }
    }
  ]
}
```

**请求字段**（每个事件的公共字段）：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `event_id` | string | 是 | 客户端或服务端生成的唯一事件 ID，用于去重 |
| `event_name` | string | 是 | 来自注册表的稳定名称 |
| `event_schema_version` | string | 是 | 事件字段契约版本 |
| `occurred_at` | string | 是 | UTC 事件发生时间 |
| `environment` | string | 是 | `demo` / `development` / `test` / `pilot` / `production` |
| `app_version` | string | 是 | 产生事件的应用版本 |
| `mode` | string | 是 | `quick` / `formal` / `training`；起始页事件可为 `entry` |
| `source_kind` | string | 是 | `custom` / `sample` / `training_fixture` / `internal_test` |
| `analytics_session_id` | string | 是 | 对应 PRD 逻辑字段 `session_key` 的非秘密分析会话 ID；不得使用游客认证凭证 |
| `actor_key` | string\|null | 否 | 匿名或假名化用户键；不得使用邮箱、电话或姓名 |
| `stage` | string\|null | 否 | 当前业务步骤或正式项目章节 |
| `experiment_id` | string\|null | 否 | 产品实验标识；没有实验时不传 |
| `attributes` | object | 是 | 由 `event_name + event_schema_version` 决定的事件专属字段；只允许注册字段 |

**授权**：`actor_kind=guest` 或 `actor_kind=user`。

**响应**（`202`）：

```json
{
  "data": {
    "accepted_count": 1,
    "rejected_count": 0,
    "duplicates_count": 0
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**（对齐 PRD §12.5、ADD §18.3）：

- 按 `event_id` 全局去重；同一业务命令重试不得重复计入成功指标；
- 未知 Schema 版本进隔离而非静默解析；
- `attributes` 必须通过对应事件版本的严格 Schema：PRD §12.5 “主要附加字段”列出的字段按事件分别定义必填性；缺少必填字段或出现未知字段时拒绝该事件，不能用开放 JSON 静默接收；
- `analytics_session_id` 与游客认证 `session_key` 是不同标识。服务端不得把认证凭证写入产品事件；收到疑似 `sk_` 凭证格式时拒绝并记录不含原值的安全告警；
- **禁止字段**：任何事件都不得包含原始需求文本、用户回答正文、材料片段、文件名、Prompt、模型完整输入输出、姓名、邮箱、电话、证件信息或协议正文；禁止字段必须被 Schema 校验拒绝；
- 离线补发带上限，去重并设置上限；
- 埋点失败不得阻断用户主流程；
- Demo、内部测试、样例、自定义真实会话分层统计，默认产品指标排除 `internal_test`；
- 客户端时间与服务端接收时间差异超阈值时标记时钟异常。

**最小事件注册表**（P0/P1/P2 优先级）：

- P0：`mode_selected`、`agreement_action`、`identity_action`、`quick_session_started`、`coverage_slot_changed`、`question_interaction`、`understanding_reviewed`、`topic_change_resolved`、`option_preference_recorded`、`brief_generated`、`brief_viewed`、`brief_exported`、`brief_usefulness_feedback`、`quick_session_abandoned`、`upgrade_result`、`error_presented`、`recovery_action`；
- P1：`formal_stage_entered`、`formal_gate_action`、`report_result`、`change_action`；
- P2：`training_attempt_started`、`training_question_asked`、`training_summary_submitted`、`training_feedback_viewed`、`training_attempt_completed`。

### 12B.2 最小 SQL 报表端点（可选）

`GET /api/metrics/quick-completion-rate` 等：按 PRD §12.6 公式返回最小 SQL 报表。

**响应**（`200`）：

```json
{
  "data": {
    "metric_name": "quick-completion-rate",
    "numerator": 120,
    "denominator": 200,
    "observation_window": "7d",
    "sample_size": 200,
    "filters": { "source_kind": "custom", "environment_exclude": ["internal_test"] },
    "calculated_at": "2026-07-01T12:00:00Z"
  },
  "meta": { "request_id": "REQ_..." }
}
```

**约束**：指标必须同时展示分子、分母、观察窗、样本量和过滤条件；"目标/方案区分正确率""重大未知识别率""模拟内容误认为实时分析"和"报告是否支持真实决策"不能仅靠埋点判断，必须使用固定任务、人工量表或用户反馈。

核心指标公式（对齐 PRD §12.6）：

| 指标 | 计算规则 |
|---|---|
| 快速问诊完成率 | 7 日观察窗内产生 `brief_generated` 的自定义快速会话数 ÷ `quick_session_started` 自定义会话数 |
| 首份简报耗时 | 同一会话首次 `brief_generated.occurred_at - quick_session_started.occurred_at` 的中位数和 P90 |
| 放弃率 | 7 日内没有简报、没有成功升级且满足不活跃判定的会话数 ÷ 已开始会话数 |
| 输出可直接使用率 | `brief_usefulness_feedback.rating=usable_with_minor_or_no_edits` 的人数 ÷ 提交该反馈的人数 |
| 主题分流率 | `topic_change_resolved` 各 action 数 ÷ 主题变化提示次数 |
| 升级成功率 | `upgrade_result=succeeded` 的幂等升级命令数 ÷ `upgrade_result=started` 的幂等升级命令数 |

## 12. 错误与 HTTP 状态

| HTTP | 错误码 | 含义 |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | 字段或 Schema 不合法 |
| 401 | `AUTHENTICATION_REQUIRED` | 未认证或会话失效 |
| 403 | `FORBIDDEN` | 当前主体缺少所需项目能力 |
| 403 | `SESSION_CREDENTIAL_MISMATCH` | 登录用户持有的游客凭证不属于路径指定的快速问诊会话 |
| 403 | `AGREEMENT_REQUIRED` | 触发真实 AI 的端点缺少有效 `agreement_consents` 记录（见 §2.2、§3B.6） |
| 404 | `RESOURCE_NOT_FOUND` / `EVIDENCE_NOT_FOUND` | 资源不存在或不可见 |
| 404 | `TRAINING_CASE_NOT_FOUND` | 训练案例 ID 或版本不存在（见 §12A.2） |
| 404 | `BRIEF_VERSION_NOT_FOUND` | 需求简报指定版本不存在或不属于当前会话（见 §5A.9、§5A.10、§5A.11、§5A.12） |
| 409 | `VERSION_CONFLICT` / `IDEMPOTENCY_CONFLICT` / `BLOCKING_CONFLICT` | 并发、幂等或业务阻断 |
| 409 | `QUICK_SESSION_CLAIMED` | 指定快速问诊会话已被其他用户认领（见 §3A.3、ADR-021） |
| 409 | `UPGRADE_FAILED` | 快速问诊升级正式项目事务回滚，可按幂等键重试（见 §5A.15、ADR-022） |
| 409 | `COVERAGE_INSUFFICIENT` | 覆盖槽位未达到最低覆盖条件，拒绝生成简报（见 §5A.8） |
| 409 | `LEGAL_HOLD` | 删除范围存在法律保留或合同义务，暂停物理删除（见 §5.2、§5A.16） |
| 422 | `MODEL_SCHEMA_ERROR` / `REPORT_GATE_FAILED` | 结果存在但不满足契约或门禁 |
| 429 | `MODEL_RATE_LIMITED` | 外部模型限流，可按建议时间重试 |
| 429 | `RATE_LIMITED` / `MODEL_BUSY` / `QUEUE_FULL` | 应用层限流、单项目并发上限或全局队列满（见 §2.3） |
| 503 | `MODEL_UNAVAILABLE` | 外部模型不可用 |
| 504 | `REQUEST_TIMEOUT` | 请求超时，AI 命令可轮询 Job 状态（见 §2.3） |
| 422 | `TOKEN_BUDGET_EXCEEDED` | 项目或任务预算不足 |

`SENSITIVE_DATA_BLOCKED` 用 `403`；`JOB_RETRY_EXHAUSTED` 用 `422`。每个错误明确 `retryable`，用户输入不能因错误丢失。

新增错误码使用约束（对齐 PRD v2.3 §10 与 ADD §17.5）：

- `AGREEMENT_REQUIRED`：仅当端点列入 §2.2 协议同意前置清单且 `agreement_consents` 当前无有效记录时返回；`retryable=false`，引导用户走 §3B.1 `GET /api/agreements/active` 重新同意。
- `QUICK_SESSION_CLAIMED`：返回响应体只包含快速会话 ID，不泄露已绑定用户 ID；前端返回账户会话列表；`retryable=false`。
- `UPGRADE_FAILED`：响应体须包含 `idempotency_key` 与失败原因分类（`validation` / `state_inconsistent` / `storage`）；幂等键可在事务恢复后重试，`retryable=true`。
- `COVERAGE_INSUFFICIENT`：响应体须列出当前未达最低条件的槽位名，引导前端补足追问；`retryable=true`。
- `LEGAL_HOLD`：响应体须包含 `legal_hold=true` 和不泄露敏感业务正文的 `legal_hold_reason`；`retryable=false`，前端应展示不可删除状态并保留查询入口。
- `TRAINING_CASE_NOT_FOUND` / `BRIEF_VERSION_NOT_FOUND`：`retryable=false`，提示前端加载最新可用版本。

## 13. 需求追踪

本表对齐 PRD v2.3 §15 与 ADD §23.5 的 32 项可追踪产品需求 ID，标注每个 ID 在本文档中的主要 API 端点位置。追踪链遵循 `00-index.md §4`：PRD ID → ADD 模块/不变量 → API 命令 → 数据库实体 → FSD 页面 → 验收用例。本表只覆盖 PRD → API 这一层，下游追踪由数据库设计和 FSD 各自维护。

| PRD ID | 优先级 | 主要 API |
|---|---:|---|
| PRD-POS-001 | P0 | 默认主路径入口 `POST /api/quick-sessions`（§5A.1）；起始页仅决定路径，不强制登录 |
| PRD-MODE-001 | P0 | 快速问诊（§5A）、正式项目（§5–§11）、表达训练（§12A）三组端点相互独立，状态不互通 |
| PRD-ENTRY-001 | P0 | 演示链路不调用生产 HTTP，通过 MockTransport 使用相同 ApiClient operation；真实链路起始页分流后由 HttpTransport 请求 `POST /api/quick-sessions` 或 `POST /api/projects` |
| PRD-INTAKE-001 | P0 | `POST /api/projects`（§5.1）、`POST /api/projects/:id/intakes`（§5.2）；原始输入不可被系统候选覆盖 |
| PRD-QUICK-001 | P0 | §5A.1 `POST /api/quick-sessions` 至 §5A.16 `DELETE /api/quick-sessions/:id` 全部端点 |
| PRD-QUICK-002 | P0 | §5A.8 `POST /api/quick-sessions/:id/briefs`、§5A.9–§5A.12 简报查询、投影与导出 |
| PRD-COVERAGE-001 | P0 | §5A.4 `GET /api/quick-sessions/:id/coverage`；§5A.3 追问按槽位动态选择，不按固定轮数 |
| PRD-UNKNOWN-001 | P0 | §5A.3、§5A.4、§5A.5 携带未知项及阻断标记；阻断未知只能生成醒目标记的未完成草稿，不能生成完整简报或确定性推荐 |
| PRD-TOPIC-001 | P0 | §5A.6 `POST /api/quick-sessions/:id/topic-change`；`topic_change_resolved` 事件见 §12B.1 |
| PRD-STATE-001 | P0 | §5A.2 `QuickSessionStatus`、§6.2 项目状态机、§12A 端点状态字段三组互不映射 |
| PRD-UPGRADE-001 | P1 | §5A.15 `POST /api/quick-sessions/:id/upgrade`（ADR-022）；候选状态进入正式项目 |
| PRD-UPGRADE-002 | P1 | §5A.15 升级命令原子事务，幂等键可重试；失败返回 `409 UPGRADE_FAILED` |
| PRD-CASE-001 | P0 | 演示 Fixture 由按 operationId 注册的 Mock handler 提供，不调用生产 HTTP；真实链路通过 `GET /api/training-cases`（§12A.1）加载版本化案例 |
| PRD-FLOW-001 | P1 | `GET /api/projects/:id`（§5.4）、关口（§7）、基线（§9）、报告（§10）和变化（§11）端点 |
| PRD-GATE-001 | P1 | 类型化 `/outcomes\|drivers\|requirements\|conflicts/:id/reviews`、`/gates/.../reviews`、`POST /api/baselines/:id/approve`（§9） |
| PRD-EPI-001 | P0 | Driver 查询、Requirement provenance 字段、Fact 与 EvidenceSpan 关联端点 |
| PRD-SCOPE-001 | P1 | 范围处置（Now/Next/Later/Watch/不做）、需求修改和基线命令 |
| PRD-REPORT-001 | P1 | `POST /api/projects/:id/reports`（§10.3）、`POST /api/reports/:id/releases`（§10.4）、`GET /api/projects/:id/reports/:reportId/download`（§10.6） |
| PRD-CHANGE-001 | P1 | `POST /api/projects/:id/change-previews`（§11.1）、`POST /api/projects/:id/changes`（§11.2）、`POST /api/changes/:id/confirm`（§11.3） |
| PRD-TRAIN-001 | P2 | §12A.1 `GET /api/training-cases` 至 §12A.8 `POST /api/training-attempts/:id/complete` 全部端点 |
| PRD-IDENTITY-001 | P0 | §3A.1 `POST /api/guest-sessions`、§3A.2 `GET /api/guest-sessions/current`、§3A.3 `POST /api/quick-sessions/:id/claim`（ADR-021） |
| PRD-AGREEMENT-001 | P0 | §3B.1 `GET /api/agreements/active`、§3B.2 `POST /api/agreements/:versionId/accept`、§3B.3 `POST /api/agreements/:versionId/reaccept`、§3B.4 `POST /api/agreements/consents/:id/withdraw`（ADR-020） |
| PRD-RETENTION-001 | P0 | `DELETE /api/projects/:id`、`DELETE /api/quick-sessions/:id` 创建删除任务；`GET /api/delete-tasks/:id` 查询进度、失败和法律保留；数据库 §14.2/§14.3 定义分层期限与独立删除账本 |
| PRD-NFR-001 | P0 | 关键流程响应时间目标由 ADD §18.1 定义；端点在响应 `meta` 中携带 `request_id` 供追踪 |
| PRD-RISK-001 | P1 | 高风险结论在 §7 关口端点和 §5.5 角色端点中要求 `reviewer_role`；`review_actions` 由 §7 命令创建 |
| PRD-PREFERENCE-001 | P0 | §5A.7 `POST /api/quick-sessions/:id/option-preferences`；非推荐方案只记 `kind=preference`，不写 Decision |
| PRD-SHARE-001 | P0 | §5A.11 `POST /api/quick-sessions/:id/briefs/:version/exports` 与 `GET .../download` 不返回公开访问 URL；首期仅返回一次性签名链接或纯文本 |
| PRD-TASK-001 | P1 | 正式项目中 `tasks` 状态只能由人工或显式命令推进，不可由 AI 自动通过 |
| PRD-AUTH-001 | P1 | §3 身份与能力表、§5.3 `POST /api/projects/:id/members`、§5.5 `PATCH /api/projects/:id/members/:userId` |
| PRD-USABILITY-001 | P0 | 渐进披露由前端控制；API 端点通过字段分组（`summary` / `detail` / `audit`）支持按需返回 |
| PRD-ACTION-001 | P0 | 关键操作在 §5A、§7、§9、§10、§11 命令中均含前置条件校验、成功响应和失败错误码；事件见 §12B.1 |
| PRD-ANALYTICS-001 | P0 | §12B.1 `POST /api/events`、§12B.2 指标查询端点；公共字段、最小事件注册表和禁止字段见对应章节 |

API 契约变更需要兼容性评审；破坏性变更使用新的 `/api/vN`，并提供迁移窗口和契约测试。新增 PRD ID 时，必须在同一变更中补充本表对应行，并与 ADD §23.5 保持一致。

## 14. 晋级条件

本文档当前状态为 **v1（对齐 PRD v2.3 / ADD v1.4）**，已通过下列全部晋级条件。后续版本变更必须通过兼容性评审。

### 14.1 Draft → v1-rc（真实 HTTP 试点启动前，已达成）

在真实 HTTP 封闭试点启动前，文档必须从当前 Draft 状态晋级至 v1-rc，需满足以下条件：

1. **OpenAPI 3.1 校验通过**：将本文档的所有端点、请求/响应 Schema 和错误码落为完整的 OpenAPI 3.1 规范文件，并通过开源校验器严格模式验证。
2. **所有写命令有授权/幂等/并发/错误示例**：每个 POST/PATCH 端点必须在 OpenAPI 中定义：
   - 所需的认证和角色/能力声明（对应 §3 身份与能力表）
   - `Idempotency-Key` 请求头要求（对应 §2 通用约定）
   - `expected_version` 乐观锁字段及 `VERSION_CONFLICT` 错误响应
   - 至少一个完整的错误响应示例（含 `error.code`、`message`、`retryable`）

### 14.2 v1-rc → v1（对齐 PRD v2.3 / ADD v1.4，已达成）

v1-rc 晋级至 v1 必须同时满足下列四类条件：

1. **三模式端点完整**：
   - 快速问诊五步流程对应 §5A.1 至 §5A.15 共 15 个端点全部定义（覆盖输入、追问、覆盖、理解确认、主题变化、方案偏好、简报生成与投影、导出、反馈、放弃、归档与升级）；
   - 表达训练 §12A.1 至 §12A.8 共 8 个端点全部定义（含版本化案例、追问只记哈希、总结只存哈希、反馈与重试）；
   - 正式项目 §5 至 §11 原有端点结构未被破坏，未因新增端点删除原有契约。

2. **身份与协议端点完整**：
   - §3A 游客签发/恢复与指定快速会话认领端点落地，认领返回 `409 QUICK_SESSION_CLAIMED`（ADR-021）；
   - §3B 协议同意四端点（激活版本、首次或非重大同意、重大更新重新同意、撤回）落地，撤回立即阻止新调用（ADR-020）；
   - §2.2 列入的 11 个“进入真实 AI 流程或直接触发模型”的端点均执行 `agreement_consents` 前置校验，未同意返回 `403 AGREEMENT_REQUIRED`；其中 §2.4 的 8 个实际 AI 写命令统一返回 `202 + job_id`；
   - §5A.15 升级操作按 ADR-022 实现原子事务（projects + Owner 成员 + intake + 复制候选 + upgrade_records），失败返回 `409 UPGRADE_FAILED` 且可按幂等键重试。

3. **错误码与追踪表完整**：
   - §12 错误与 HTTP 状态表包含 `AGREEMENT_REQUIRED`、`UPGRADE_FAILED`、`QUICK_SESSION_CLAIMED`、`TRAINING_CASE_NOT_FOUND`、`BRIEF_VERSION_NOT_FOUND`、`COVERAGE_INSUFFICIENT` 六个新错误码，并补充使用约束（`retryable`、响应体字段）；
   - §13 PRD ID 追踪表对齐 PRD v2.3 §15 与 ADD §23.5 共 32 项，每项标注优先级与主要 API 端点位置。

4. **产品埋点契约存在**：
   - §12B.1 `POST /api/events` 定义公共字段、最小事件注册表（P0/P1/P2 分级）和禁止字段；
   - §12B.2 指标查询端点定义核心指标公式（完成率、首份简报耗时、放弃率、输出可直接使用率、主题分流率、升级成功率）。

### 14.3 v1 → 后续版本（试点后回归测试）

真实 HTTP 封闭试点完成后，进入 v1 后续版本需通过下列回归测试，不通过则回滚至 v1：

1. **上传失败路径有端到端测试通过**：覆盖以下场景的自动化测试全部通过：
   - 文件类型/签名校验失败 → 返回 `400 VALIDATION_ERROR`
   - 文件大小超限 → 返回 `400 VALIDATION_ERROR`
   - 解析失败 → `sources.extraction_status` 转为 `failed`，不阻塞其他来源
   - 存储写入失败 → 事务回滚，不产生孤立 `blobs` 记录

2. **报告发布失败路径有端到端测试通过**：覆盖以下场景的自动化测试全部通过：
   - 渲染过程崩溃 → 报告状态转入 `publish_failed`，临时文件可被恢复任务清理
   - 文件写入磁盘失败 → 报告状态转入 `publish_failed`，不产生 `released` 记录
   - 发布门禁失败 → 报告状态转入 `publish_failed`，保留 `staged` blob 供重试
   - 崩溃恢复：数据库有 `staged` 记录但文件缺失 → 转入 `publish_failed`，绝不标为 `released`

3. **快速问诊关键路径有端到端测试通过**（v1 新增）：
   - 覆盖槽位未达最低条件 → §5A.8 返回 `409 COVERAGE_INSUFFICIENT`，响应体列出缺失槽位；
   - 升级操作中途存储失败 → §5A.15 返回 `409 UPGRADE_FAILED`，幂等键可在恢复后重试且不产生重复 `upgrade_records`；
   - 指定快速会话认领冲突 → §3A.3 返回 `409 QUICK_SESSION_CLAIMED`，响应体不泄露已绑定用户信息；
   - 协议撤回后调用真实 AI 端点 → §5.1、§8.1、§10.3、§5A.1、§5A.3、§5A.15、§12A.3、§12A.4 全部返回 `403 AGREEMENT_REQUIRED`。

v1 后续版本晋级后，所有后续 API 变更必须通过兼容性评审，破坏性变更需使用新的 `/api/vN` 基础路径，并提供迁移窗口和契约测试。

