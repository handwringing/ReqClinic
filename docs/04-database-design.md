# 需求问诊室 · 数据库设计

> 文档状态：物理设计基线 v1.3（对齐 PRD v2.3 / ADD v1.5 / API v1.3；当前迁移已覆盖快速问诊与正式项目首期真实链路）
> 适用阶段：真实快速问诊、正式项目首期链路与表达训练首期链路
> 更新日期：2026-07-05
> 逻辑模型：[ADD](./02-architecture.md)
> 服务契约：[API 设计](./03-api-design.md)

> **v1.1 主要变更**：删除用户级项目出站选项；来源限制改为内部安全状态；为游客身份、删除任务、快速问诊轮次/未知项、升级回滚和游客幂等补齐物理结构。后续由 v1.2 统一令牌摘要、认领粒度和正式项目语义。

> **v1.2 主要变更**：正式项目删除冗余 `mode`；游客凭证改为可索引的 HMAC 摘要；认领粒度改为指定 `quick_session`；AI Job 改为正式项目/快速会话/训练尝试三类互斥作用域并支持用户/游客创建与取消；补齐用户/游客 XOR 约束、协议正文引用、事件专属属性、删除状态查询数据与数据库外删除账本；删除项目/来源出站策略字段，真实 AI 仅以有效协议同意作为产品前置条件；清理错误的阻断未知语义。
> **v1.3 当前实现补充**：当前仓库已有 `0000` 基础迁移、`0001_agent_skill_audit.sql`、`0002_skill_run_usage_audit.sql`、`0003_formal_map_snapshots.sql` 和 `0004_training_turns.sql`。快速问诊和正式项目首期真实链路已使用 `quick_*`、`brief_versions`、`ai_jobs`、`agent_runs`、`skill_runs`、`formal_map_snapshots` 和 `formal_turns` 等结构；表达训练已使用基础五表与 `training_turns` 支持真实角色回答、训练回合恢复和反馈 Runtime。

### v1 主要变更（相对 Draft v0.1）

对齐 PRD v2.3 冻结基线与 ADD v1.4，新增覆盖三种产品模式、游客身份、协议同意、升级原子性和分层保留策略所需的物理表与约束；原有正式项目表保持不变：

- §3 新增 `guest_sessions`、协议版本与同意表（`agreement_versions`、`agreement_consents`）；`project_intakes` 增加升级来源关联列；早期草案曾为 `projects` 增加模式列，已在 v1.2 删除；
- §4A 定义快速问诊与需求简报 7 张表：`quick_sessions`、`quick_turns`、`quick_unknowns`、`brief_versions`、`brief_exports`、`option_preferences`、`upgrade_records`；
- §7A 新增待办任务表 `tasks`（逾期与无人负责不得自动通过关口，AI 不得代办）；
- §11A 新增产品埋点事件表 `product_events`（公共字段、禁止字段、90 天保留）；
- §12A 新增表达训练 5 张表：`training_cases`、`training_attempts`、`training_questions`、`training_summaries`、`training_feedback`（训练数据与真实项目隔离）；
- §11 新增升级命令事务边界（原子、幂等、失败完全回滚）；
- §14 扩展为 9 类分层保留策略，新增 `delete_tasks` 表与备份/恢复重放约束；
- §13 索引补充新表必要索引；
- §16 PRD ID 追踪表从 11 项扩展到 32 项，对齐 ADD §23.5。

## 1. 职责与实现基线

本文定义目标物理设计基线，并记录当前仓库迁移的实现状态。当前 SQLite 迁移已经覆盖快速问诊、正式项目首期地图、AI Job、Agent/Skill 审计和训练基础表；进入发布候选前仍必须在空库和生产规模样本上执行迁移，并用约束、恢复和删除测试验证。当前实现使用 SQLite 单写应用进程、本地文件存储和 WAL；业务层通过 Repository 访问。

```text
SQLite >= 3.45
PRAGMA foreign_keys = ON
PRAGMA journal_mode = WAL
PRAGMA synchronous = FULL
PRAGMA busy_timeout = 5000
```

数据库与文件目录必须位于同一受控设备，不能放在网络共享盘。审计、确认和报告发布优先数据持久性，因此 v1 使用 `FULL`；若未来改为 `NORMAL`，必须记录可接受的断电丢失窗口并通过 ADR 批准。原始文件和 PDF 存文件系统，数据库保存 blob、哈希、状态和权限元数据。

## 2. 类型、命名与通用列

- 表名、列名使用 `snake_case`；业务 ID 为带类型前缀的 `TEXT`；
- 时间为 UTC ISO 8601 `TEXT`，由应用层统一生成；布尔值为 `INTEGER CHECK (value IN (0,1))`；
- 金额、比例和计量值禁止用二进制浮点；保存原值、十进制定点文本和单位；
- JSON 为 canonical JSON `TEXT CHECK (json_valid(column))`；高频筛选字段不得只存在 JSON 内；
- 可变聚合根含 `version INTEGER NOT NULL DEFAULT 1`，每次修改原子递增；
- 业务历史优先使用状态、版本表和替代关系，不对已进入基线或审计链的行做物理删除；
- 所有外键显式声明。父记录存在历史引用时使用 `RESTRICT`，纯从属临时数据才使用 `CASCADE`。
- 迁移文件不得依赖 SQLite 对外键动作的隐式默认值。本文早期 DDL 片段中若仍出现未展开 `ON DELETE` 的 `REFERENCES`，迁移生成时必须按 `ON DELETE RESTRICT` 展开，并在迁移校验中拒绝无删除动作声明的外键。

## 3. 身份、项目与原始建档

### 3.1 `users`

```text
id TEXT PRIMARY KEY
display_name TEXT NOT NULL
email TEXT NULL COLLATE NOCASE
auth_subject TEXT NOT NULL UNIQUE
status TEXT NOT NULL CHECK (status IN ('active','disabled'))
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

`email` 不是身份主键；认证提供方稳定标识保存在 `auth_subject`。

#### 3.1.1 `guest_sessions`

游客在同意协议后可完成同浏览器快速问诊与简报导出，不要求先注册。游客由不可直接识别个人的会话凭证标识（ADR-021、§17.4）。

```text
id TEXT PRIMARY KEY
session_key_digest TEXT NOT NULL UNIQUE
created_at TEXT NOT NULL
last_active_at TEXT NOT NULL
expires_at TEXT NOT NULL
```

约束：

- `session_key` 不得直接是邮箱、电话或姓名；由服务端生成的不可识别个人会话凭证；
- `session_key_digest` 保存 `HMAC-SHA-256(server_pepper, session_key)` 的确定性摘要；游客令牌必须具有至少 128 bit 熵。随机盐密码哈希不适合按令牌直接索引查找；
- 原始 `session_key` 只在签发时返回一次，并作为 `guest_session` Cookie 的值通过 HttpOnly/Secure/SameSite=Strict Cookie 下发；
- 后续任何端点不再返回原始凭证；
- 认证时对提交令牌计算摘要并使用唯一索引等值查找，摘要比较使用常量时间实现；服务端 pepper 只存在密钥环境，不进入数据库或日志；
- 认领发生在指定 `quick_sessions`，不改变或整体认领 `guest_sessions`；
- 账户已有其他会话时分别保留，不静默合并内容；
- 认领失败时继续保留游客会话及其凭证，允许安全重试，不得产生半绑定状态；
- `expires_at` 默认按最后活动时间顺延 30 天；关联仍有效快速问诊/训练会话时，以会话保留策略为准，但游客凭证本身到期后不能继续用于新调用；
- 跨设备历史、长期保存和团队协作生产能力可以要求登录；本地开发和 demo 环境允许游客通过 formal owner bridge 映射为受控用户来体验正式项目，正式项目物理归属仍落在 `users`。

### 3.2 `projects`

```text
id TEXT PRIMARY KEY
owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
name TEXT NULL
description TEXT NULL
status TEXT NOT NULL CHECK (status IN ('Draft','Ingesting','Eliciting','Reviewing','Baselined','Reporting','Released','Changing','Archived'))
risk_level TEXT NOT NULL DEFAULT 'unknown' CHECK (risk_level IN ('unknown','low','medium','high'))
current_domain_profile_id TEXT NULL
language TEXT NOT NULL DEFAULT 'zh-CN'
version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
archived_at TEXT NULL
```

`current_domain_profile_id` 在 `domain_profiles` 建表后添加延迟外键，应用事务还要验证画像属于同一项目且状态为 `approved`。

`projects` 只表示正式项目。快速问诊和表达训练分别存于 `quick_sessions` 与 `training_attempts`，不得通过 `projects.mode` 伪装成正式项目。

### 3.3 `project_members`

```text
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json))
status TEXT NOT NULL CHECK (status IN ('active','revoked'))
granted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
PRIMARY KEY (project_id, user_id)
```

创建项目时必须同事务插入 Owner 成员，其能力至少包括 `read, edit, review, export, manage_members`。不存在管理数据出站策略的成员能力。成员能力或状态变更必须携带 `expected_version`，成功后递增 `version`，与 API `PATCH /projects/:id/members/:userId` 对齐。

### 3.4 `project_intakes`

```text
id TEXT PRIMARY KEY
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
intake_version INTEGER NOT NULL CHECK (intake_version > 0)
original_text TEXT NOT NULL CHECK (length(trim(original_text)) > 0)
decision_intent TEXT NULL
selected_work_type TEXT NULL
candidate_roles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(candidate_roles_json))
candidate_constraints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(candidate_constraints_json))
source_channel TEXT NOT NULL DEFAULT 'web'
submitted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
supersedes_intake_id TEXT NULL REFERENCES project_intakes(id) ON DELETE RESTRICT
source_quick_session_id TEXT NULL REFERENCES quick_sessions(id) ON DELETE SET NULL
source_brief_version_id TEXT NULL REFERENCES brief_versions(id) ON DELETE SET NULL
source_quick_session_hash TEXT NULL
source_brief_snapshot_hash TEXT NULL
content_hash TEXT NOT NULL
created_at TEXT NOT NULL
UNIQUE (project_id, intake_version)
CHECK ((intake_version = 1 AND supersedes_intake_id IS NULL)
    OR (intake_version > 1 AND supersedes_intake_id IS NOT NULL))
CHECK ((source_quick_session_id IS NULL AND source_brief_version_id IS NULL)
    OR (source_quick_session_id IS NOT NULL AND source_brief_version_id IS NOT NULL))
CHECK ((source_quick_session_hash IS NULL AND source_brief_snapshot_hash IS NULL)
    OR (source_quick_session_hash IS NOT NULL AND source_brief_snapshot_hash IS NOT NULL))
CHECK (source_quick_session_id IS NULL OR source_quick_session_hash IS NOT NULL)
```

`NULL` 不参与普通唯一约束，不能依靠含 `supersedes_intake_id` 的联合 UNIQUE 阻止重复初始记录。迁移必须建立：

```sql
CREATE UNIQUE INDEX uq_project_intake_initial
ON project_intakes(project_id) WHERE supersedes_intake_id IS NULL;

CREATE UNIQUE INDEX uq_project_intake_successor
ON project_intakes(project_id, supersedes_intake_id)
WHERE supersedes_intake_id IS NOT NULL;
```

> 部分唯一索引（`WHERE` 子句）要求 SQLite >= 3.45，与 §1 的 SQLite 版本约束一致。`uq_project_intake_initial` 保证每个项目最多有一个初始版本（`supersedes_intake_id IS NULL`）；`uq_project_intake_successor` 保证同一前驱只能被一个后继替代。当前版本通过“未被其他行引用为 `supersedes_intake_id`”查询，不能把初始版本误称为当前版本。

表上禁止 UPDATE/DELETE 的应用权限；修订通过新行追加。触发器拒绝跨项目引用、非前一版本链和内容哈希重复。

`source_quick_session_id` 与 `source_brief_version_id` 是可导航来源关系；升级事务同时固定两个来源哈希并把原始输入/候选快照复制到正式 intake。用户依法删除快速侧数据时，外键置空但哈希和正式 intake 快照继续证明来源完整性，不保留已请求删除的快速正文；普通正式项目四个来源字段均为 `NULL`。

### 3.5 协议版本与同意

真实 AI 使用以有效协议同意为前提（ADR-020、§17.5）。协议正文属于单独法律任务，本设计不定义具体文本，但协议版本和状态属于产品必需数据。

#### 3.5.1 `agreement_versions`

```text
id TEXT PRIMARY KEY
version TEXT NOT NULL UNIQUE
status TEXT NOT NULL CHECK (status IN ('draft','active','superseded','withdrawn'))
change_type TEXT NOT NULL CHECK (change_type IN ('major','minor'))
effective_at TEXT NOT NULL
content_ref TEXT NOT NULL
superseded_by TEXT NULL REFERENCES agreement_versions(id) ON DELETE RESTRICT
created_at TEXT NOT NULL
```

约束：

- `version` 如 "1.0.0"，全局唯一；
- `change_type` 区分"重大更新"与"非重大更新"；判断标准和审批责任由法律任务定义，产品不能自行把重大更新降级；
- 重大更新生效后，用户下一次发起新的真实 AI 调用前必须重新同意；非重大更新可以通知用户，既有有效同意继续有效；
- 新版本生效时旧 `active` 版本转入 `superseded`，`superseded_by` 指向新版本；
- 重新同意形成新记录，不覆盖旧版本记录，也不追溯改变旧处理行为的合法性状态。

#### 3.5.2 `agreement_consents`

```text
id TEXT PRIMARY KEY
agreement_version_id TEXT NOT NULL REFERENCES agreement_versions(id) ON DELETE RESTRICT
actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','guest'))
user_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT
guest_session_id TEXT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT
action TEXT NOT NULL CHECK (action IN ('accepted','reaccepted','withdrawn'))
scope TEXT NOT NULL CHECK (scope IN ('quick','formal','training','all'))
channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','cli','api'))
occurred_at TEXT NOT NULL
received_at TEXT NULL
CHECK ((actor_kind='user' AND user_id IS NOT NULL AND guest_session_id IS NULL)
    OR (actor_kind='guest' AND user_id IS NULL AND guest_session_id IS NOT NULL))
```

约束：

- `user_id`/`guest_session_id` 由认证上下文写入，客户端不得提交或选择操作人；XOR CHECK 和外键保证身份存在且类型一致；API 展示需要统一 `actor_id` 时由服务层投影；
- `received_at` 真实 HTTP 链路起填，用于识别离线补发和时钟异常；
- 首次使用真实 AI 前必须存在 `action='accepted'` 或 `action='reaccepted'` 的有效记录；未同意时不能提交真实 AI 问诊；
- 撤回（`action='withdrawn'`）后立即阻止新的模型调用，并取消尚未发送给模型供应商的排队任务；已经发送的进行中调用可能无法撤回，允许其结束并按既定保留策略处理结果，但不得自动发起后续模型调用；
- 撤回同意不等于删除数据，用户需要单独发起删除（§14）；
- 游客登录认领后历史同意记录与账户关联但不改写原操作身份；
- 协议同意/撤回记录默认保留 2 年；法律要求不同则按适用期限，且保留依据可审计（§9.5、§10.5）。

## 4. 领域画像与专业包

### 4.1 `domain_profiles`

```text
id TEXT PRIMARY KEY
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
profile_version INTEGER NOT NULL CHECK (profile_version > 0)
work_type TEXT NOT NULL
domain_labels_json TEXT NOT NULL CHECK (json_valid(domain_labels_json))
risk_flags_json TEXT NOT NULL CHECK (json_valid(risk_flags_json))
terminology_map_json TEXT NOT NULL CHECK (json_valid(terminology_map_json))
suggested_pack_ids_json TEXT NOT NULL CHECK (json_valid(suggested_pack_ids_json))
required_human_roles_json TEXT NOT NULL CHECK (json_valid(required_human_roles_json))
routing_risk TEXT NOT NULL CHECK (routing_risk IN ('low','medium','high','unknown'))
routing_basis_json TEXT NOT NULL CHECK (json_valid(routing_basis_json))
rationale_evidence_links_json TEXT NOT NULL CHECK (json_valid(rationale_evidence_links_json))
unknowns_json TEXT NOT NULL CHECK (json_valid(unknowns_json))
status TEXT NOT NULL CHECK (status IN ('candidate','under_review','approved','rejected','superseded'))
classifier_model TEXT NULL
prompt_version TEXT NULL
approved_by TEXT NULL REFERENCES users(id) ON DELETE RESTRICT
approved_at TEXT NULL
supersedes_profile_id TEXT NULL REFERENCES domain_profiles(id) ON DELETE RESTRICT
created_at TEXT NOT NULL
UNIQUE (project_id, profile_version)
```

`approved` 要求 `approved_by/approved_at` 非空；候选和评审中画像不得被设为项目当前画像。状态转换限定为 `candidate → under_review → approved | rejected`，已批准旧版本才能进入 `superseded`。跨项目证据链接由事务校验。

### 4.2 v1 静态领域配置

```text
domain_packs(
  id TEXT, version TEXT, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('released','deprecated')),
  compatible_core_schema TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)), manifest_hash TEXT NOT NULL,
  released_at TEXT NOT NULL, deprecated_at TEXT NULL,
  PRIMARY KEY(id, version)
)

project_domain_packs(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  domain_pack_id TEXT NOT NULL, domain_pack_version TEXT NOT NULL,
  domain_profile_id TEXT NOT NULL REFERENCES domain_profiles(id),
  activation_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','inactive')),
  activated_by TEXT NOT NULL REFERENCES users(id), activated_at TEXT NOT NULL, deactivated_at TEXT NULL,
  FOREIGN KEY(domain_pack_id, domain_pack_version) REFERENCES domain_packs(id, version)
)
```

v1 只预置 `general` 和 `software-delivery`，不提供创建、组合或运行时扩展 Schema。一个项目同一配置同时最多一个 `active` 版本。`domain_entity_extensions`、`candidate_extensions` 和评估套件表推迟到正式支持第二个差异显著的领域并通过 ADR 后再建。

## 4A. 快速问诊会话与需求简报

快速问诊为默认主路径（P0，ADR-018、§0.6、§11.2），输出需求简报（非基线）。本节定义快速问诊会话、版本化简报、导出、方案偏好和升级记录表。快速问诊状态机 `draft → clarifying → understanding_review → option_review → brief_ready → upgraded/archived` 独立于正式项目状态机（§12.1）。

### 4A.1 `quick_sessions`

```text
id TEXT PRIMARY KEY
guest_session_id TEXT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT
user_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT
origin_guest_session_id TEXT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT
claimed_at TEXT NULL
status TEXT NOT NULL CHECK (status IN ('draft','clarifying','understanding_review','option_review','brief_ready','upgraded','archived'))
source_kind TEXT NOT NULL CHECK (source_kind IN ('custom','sample','training_fixture','internal_test'))
source_case_id TEXT NULL
original_input TEXT NOT NULL CHECK (length(trim(original_input)) > 0)
intent TEXT NULL
decision_intent TEXT NULL
coverage_slots_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(coverage_slots_json))
current_understanding_version INTEGER NOT NULL DEFAULT 0
current_brief_version_id TEXT NULL REFERENCES brief_versions(id) ON DELETE SET NULL
expires_at TEXT NULL
last_active_at TEXT NOT NULL
upgraded_at TEXT NULL
archived_at TEXT NULL
created_at TEXT NOT NULL
version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
CHECK ((guest_session_id IS NOT NULL AND user_id IS NULL)
    OR (guest_session_id IS NULL AND user_id IS NOT NULL))
CHECK (origin_guest_session_id IS NULL OR origin_guest_session_id = guest_session_id OR user_id IS NOT NULL)
```

约束：

- `guest_session_id` 与 `user_id` 二者有且只有一个非空（游客时 `user_id` 为空，登录用户时 `guest_session_id` 为空）；
- 游客认领指定快速会话时，在同一事务中将 `user_id` 设为当前登录用户、`origin_guest_session_id` 保存原 `guest_session_id`、当前 `guest_session_id` 置空、写入 `claimed_at`、把 `expires_at` 改为最后活动后 180 天并递增版本；同一游客身份下其他会话不变；
- `original_input` 不可变；修订形成新版本或通过问答补充，不覆盖原文；
- `source_kind` 区分自定义输入（`custom`）、示例案例（`sample`）、训练/评估 Fixture（`training_fixture`）与内部测试（`internal_test`）；默认产品指标排除 `internal_test`，演示 Fixture 不进入生产数据库，真实 HTTP 链路只在受控测试或评估数据中使用 `training_fixture/internal_test`；
- `source_case_id` 在 `sample/training_fixture/internal_test` 时引用案例或测试场景逻辑 ID；
- `status` 状态机：`draft → clarifying → understanding_review → option_review → brief_ready → upgraded/archived`；状态不得映射为正式项目状态或训练状态；
- `coverage_slots_json` 记录六类覆盖槽位（期望结果、用户/相关对象、核心场景、范围边界、完成判断、约束与风险）的覆盖状态；进度显示覆盖情况，不得显示虚假完成百分比；
- `expires_at`：未登录会话最后活动后 30 天，已登录会话最后活动后 180 天（§9.5、§10.5）；
- `understanding_review` 的"理解正确"只表示当前摘要符合用户表达，不产生正式 ReviewAction，不等于正式审批、已接受需求或需求基线；
- `brief_ready` 不是不可逆的"完成"终点，用户可继续补充并产生新版本；
- `upgraded` 后快速会话与正式项目通过只读来源关系关联，二者后续版本分别演化；
- `intent` 希望用于什么；`decision_intent` 希望作出什么决定。
- 问答轮次和未知项分别存于 `quick_turns` 和 `quick_unknowns`，不依赖 JSON；
- `coverage_slots_json` 记录覆盖状态摘要，明细见子表。

#### 4A.1a `quick_turns`

```text
id TEXT PRIMARY KEY
quick_session_id TEXT NOT NULL REFERENCES quick_sessions(id) ON DELETE CASCADE
turn_index INTEGER NOT NULL CHECK (turn_index >= 0)
role TEXT NOT NULL CHECK (role IN ('ai','user'))
question_id TEXT NULL
content TEXT NOT NULL
understanding_version INTEGER NULL
created_at TEXT NOT NULL
UNIQUE(quick_session_id, turn_index)
```

约束：

- 记录每一轮对话（AI 提问和用户回答分别存行），支持恢复对话和保留问答；
- `question_id` 为 AI 生成的问题 ID，用户回答行可为 NULL；
- `understanding_version` 标记该轮回答影响的理解版本号；
- 删除快速会话时级联删除轮次。

#### 4A.1b `quick_unknowns`

```text
id TEXT PRIMARY KEY
quick_session_id TEXT NOT NULL REFERENCES quick_sessions(id) ON DELETE CASCADE
category TEXT NOT NULL CHECK (category IN ('expected_outcome','user_object','core_scenario','scope_boundary','completion_criteria','constraints_risks'))
description TEXT NOT NULL
is_blocking INTEGER NOT NULL DEFAULT 1 CHECK (is_blocking IN (0,1))
resolved_at TEXT NULL
resolved_by_turn_id TEXT NULL REFERENCES quick_turns(id) ON DELETE SET NULL
created_at TEXT NOT NULL
```

约束：

- 记录快速问诊过程中识别的未知项明细，不依赖 JSON 解析；
- `category` 对应六类覆盖槽位，并与 OpenAPI `CoverageSlot` 保持同值：期望结果、用户/相关对象、核心场景、范围边界、完成判断、约束与风险；
- `is_blocking=1` 阻止生成“完整简报”和确定性推荐，但用户接受缺口后仍可生成醒目标记的未完成草稿（`brief_versions.is_incomplete=1`）；
- `resolved_at` 非空表示已解决；`resolved_by_turn_id` 指向解决该未知项的对话轮次。

### 4A.2 `brief_versions`

```text
id TEXT PRIMARY KEY
quick_session_id TEXT NOT NULL REFERENCES quick_sessions(id) ON DELETE CASCADE
version INTEGER NOT NULL CHECK (version > 0)
snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
is_incomplete INTEGER NOT NULL DEFAULT 0 CHECK (is_incomplete IN (0,1))
blocking_unknown_count INTEGER NOT NULL DEFAULT 0
generated_at TEXT NOT NULL
generated_by TEXT NOT NULL
UNIQUE(quick_session_id, version)
```

约束：

- `snapshot_json` 为版本化结构化需求简报，包含事实、需求、未知、方案和完成条件；
- 概述和详细报告从同一份 `snapshot_json` 投影，只改变篇幅、顺序和用词，不得单独生成新事实、需求或决策（PRD §5.6）；
- `is_incomplete=1` 表示带缺口的未完成草稿；阻断未知存在时只能生成醒目标记的未完成草稿，不给出确定性推荐；
- `blocking_unknown_count` 记录简报中的阻断未知数量；
- `generated_by` 为 `users.id` 或 `guest_sessions.id`；
- 每次用户确认理解、保存重要修改或接受方案取舍时生成新的 `brief_version`；旧导出物不被静默改写。

### 4A.3 `brief_exports`

```text
id TEXT PRIMARY KEY
brief_version_id TEXT NOT NULL REFERENCES brief_versions(id) ON DELETE CASCADE
view_type TEXT NOT NULL CHECK (view_type IN ('simple','exec'))
export_type TEXT NOT NULL CHECK (export_type IN ('copy','download'))
exported_at TEXT NOT NULL
exported_by TEXT NOT NULL
expires_at TEXT NULL
```

约束：

- `view_type` 两种页面投影：概述（`simple`）、详细报告（`exec`）；
- `export_type` 区分复制（`copy`）与下载（`download`）；
- 演示链路和真实 HTTP 试点首期不提供无需认证的公开分享链接；快速问诊只提供复制内容和下载指定 `brief_version`（PRD §11.5）；
- 导出物必须显示模式、版本、生成时间和"非正式项目基线"说明；
- 服务端临时导出文件 `expires_at` 默认 24 小时（§9.5）；正式报告源文件随正式项目保留；
- 新版本不会远程改写已经下载的旧文件；需要撤销旧输出时通过新版本、状态说明和项目内提示处理。

### 4A.4 `option_preferences`

```text
id TEXT PRIMARY KEY
quick_session_id TEXT NOT NULL REFERENCES quick_sessions(id) ON DELETE CASCADE
brief_version_id TEXT NULL REFERENCES brief_versions(id) ON DELETE SET NULL
option_id TEXT NOT NULL
matches_ai_recommendation INTEGER NOT NULL CHECK (matches_ai_recommendation IN (0,1))
recorded_by TEXT NOT NULL
recorded_at TEXT NOT NULL
```

约束：

- 记录"用户当前偏好"，**非正式 Decision**；用户可以选择与 AI 建议不同的方案，AI 不得反复阻止用户（PRD §5.5、§13.2）；
- `matches_ai_recommendation=0` 时简报必须区分"AI 建议""用户当前偏好"和"尚待正式决定"；
- 升级正式项目后，当前偏好只作为 Candidate Decision Option/偏好来源，必须重新经过冲突与决策关口；
- `recorded_by` 为 `users.id` 或 `guest_sessions.id`；
- `option_id` 引用候选方案逻辑 ID，由 `brief_versions.snapshot_json` 中的方案列表定义。

### 4A.5 `upgrade_records`

```text
id TEXT PRIMARY KEY
quick_session_id TEXT NOT NULL REFERENCES quick_sessions(id) ON DELETE CASCADE
brief_version_id TEXT NOT NULL REFERENCES brief_versions(id) ON DELETE CASCADE
target_project_id TEXT NULL REFERENCES projects(id) ON DELETE RESTRICT
idempotency_key TEXT NOT NULL
status TEXT NOT NULL CHECK (status IN ('started','succeeded','failed'))
error_category TEXT NULL
started_at TEXT NOT NULL
completed_at TEXT NULL
UNIQUE(quick_session_id, idempotency_key)
CHECK ((status='succeeded' AND target_project_id IS NOT NULL) OR (status IN ('started','failed') AND target_project_id IS NULL))
```

约束：

- 升级操作原子且可安全重试，使用幂等键；同一会话同幂等键唯一（ADR-022、§11.5）；
- `target_project_id` 在 `status='succeeded'` 时非空，`status='failed'` 或 `status='started'` 时为 NULL（失败完全回滚不产生半成品项目）；
- 检查约束：`CHECK ((status='succeeded' AND target_project_id IS NOT NULL) OR (status IN ('started','failed') AND target_project_id IS NULL))`；
- `status` 状态：`started → succeeded | failed`；失败完全回滚，不产生半成品项目；保持 `quick_sessions` 状态为 `brief_ready`；
- 使用同一 `idempotency_key` 重试返回首次成功结果，不创建第二个项目；
- `target_project_id` 指向升级后创建的唯一正式项目；`projects` 本身只承载正式项目，不再需要模式字段；
- 若创建后发现业务错误，只能归档/纠正正式项目并保留审计，不能删除升级来源关系后伪装未发生；
- 升级映射规则见 §11.5：原始输入→不可变 `project_intake`；用户明确回答→候选陈述；AI 当前理解→`Inference`/`Proposal`；阻断/非阻断未知→`Unknown`；需求条目→Candidate Requirement；方案比较→Candidate Decision Options；用户偏好→偏好记录或候选选择；完成条件→Candidate Acceptance Criteria；"理解正确"记录→来源审计（非正式 ReviewAction）。

## 4B. 正式项目需求地图快照

正式项目首期不直接写正式基线，而是写入可版本化的需求地图快照。地图快照承载左侧 AI 对话、右侧地图节点、候选方案、待确认内容、报告投影和 token 审计来源。

### 4B.1 `formal_map_snapshots`

```text
id TEXT PRIMARY KEY
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
version INTEGER NOT NULL CHECK (version > 0)
status TEXT NOT NULL CHECK (status IN ('draft','ready','fallback'))
source_kind TEXT NOT NULL CHECK (source_kind IN ('direct','quick_upgrade','conversation_update','fallback'))
source_quick_session_id TEXT NULL REFERENCES quick_sessions(id) ON DELETE SET NULL
source_brief_version_id TEXT NULL REFERENCES brief_versions(id) ON DELETE SET NULL
ai_job_id TEXT NULL REFERENCES ai_jobs(id) ON DELETE SET NULL
snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
input_hash TEXT NOT NULL
created_at TEXT NOT NULL
UNIQUE(project_id, version)
```

约束：

- `snapshot_json` 必须通过 `formal_map_snapshot.v1` schema gate，包含 `title`、`summary`、`projectType`、`currentModuleId`、`modules[]`、`unresolvedItems[]`、`reportProjection` 和 `qualityNotes`；
- `modules[]` 数量首期控制在 3-12 个，状态只能使用用户可理解的自然语言标签，如“已整理”“正在梳理”“建议确认”“待补充”“有方案可选”；
- `reportProjection.overview` 和 `reportProjection.detailedReport` 必须来自同一份地图快照，不单独生成新事实；
- `source_kind='quick_upgrade'` 时快速简报只作为候选来源，不迁移正式确认状态；
- `status='fallback'` 表示模型不可用或输出未通过校验，系统使用确定性地图兜底，不能伪装成模型完整生成。

### 4B.2 `formal_turns`

```text
id TEXT PRIMARY KEY
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
turn_index INTEGER NOT NULL CHECK (turn_index > 0)
role TEXT NOT NULL CHECK (role IN ('user','ai'))
content TEXT NOT NULL
message_type TEXT NOT NULL CHECK (message_type IN ('question','answer','status'))
bound_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(bound_refs_json))
created_at TEXT NOT NULL
UNIQUE(project_id, turn_index)
```

约束：

- `role='ai'` 的 `question` 用于下一轮正式项目追问，不能写成正式确认；
- `bound_refs_json` 记录用户从地图节点或候选方案加入对话框的引用对象，后端按结构化引用处理，不把引用只拼进普通文本；
- 每次用户回答会触发新的 `formal_guidance` job，生成新地图快照和下一条 AI 追问。

## 5. 来源与证据

### 5.1 `blobs` 与 `sources`

```text
blobs
id TEXT PRIMARY KEY
sha256 TEXT NOT NULL UNIQUE
storage_path TEXT NOT NULL UNIQUE
byte_size INTEGER NOT NULL CHECK (byte_size >= 0)
media_type TEXT NOT NULL
scan_status TEXT NOT NULL CHECK (scan_status IN ('pending','clean','blocked','failed'))
created_at TEXT NOT NULL

sources
id TEXT PRIMARY KEY
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
blob_id TEXT NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT
file_name TEXT NOT NULL
media_type TEXT NOT NULL
source_type TEXT NOT NULL
author TEXT NULL
captured_at TEXT NULL
extracted_text_hash TEXT NULL
parser_version TEXT NULL
supersedes_source_id TEXT NULL REFERENCES sources(id) ON DELETE RESTRICT
sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public','internal','confidential','restricted'))
extraction_status TEXT NOT NULL CHECK (extraction_status IN ('uploaded','queued','parsing','parsed','failed'))
created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_at TEXT NOT NULL
```

相同哈希共享一个 `blobs` 物理对象，不同项目/语义仍保留独立 Source。`storage_path` 只存在于 blob，且必须是受控根目录下的规范化相对路径。`extraction_status` 只表达文件解析流水线状态；需要人工复核的语义问题应进入分析任务、Unknown、Conflict 或关口缺陷，不写成解析状态 `needs_review`。

### 5.2 `evidence_spans`

```text
id TEXT PRIMARY KEY
source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT
page INTEGER NULL CHECK (page IS NULL OR page > 0)
section TEXT NULL
coordinate_space TEXT NOT NULL DEFAULT 'normalized_unicode_codepoint_v1'
normalized_document_hash TEXT NOT NULL
start_offset INTEGER NOT NULL CHECK (start_offset >= 0)
end_offset INTEGER NOT NULL CHECK (end_offset > start_offset)
exact_text TEXT NOT NULL
normalized_text TEXT NOT NULL
span_hash TEXT NOT NULL
created_at TEXT NOT NULL
UNIQUE (source_id, start_offset, end_offset, span_hash)
```

Offset 固定为 `normalized_unicode_codepoint_v1`：对解析器产出的 NFC 标准化全文按 Unicode code point（非 UTF-8 字节、非 UTF-16 code unit）计数；`normalized_document_hash` 固定坐标所属文本。`exact_text` 必须等于该坐标切片，展示用 `normalized_text` 不参与定位。EvidenceSpan 创建后不可修改；解析器或标准化算法变化产生新 Source/Span 版本。

### 5.3 真实 AI 调用前置与最小化

数据库不保存项目级或来源级出站策略。AI Job 入队前和 Worker 发起外部请求前均查询当前主体是否存在有效 `agreement_consents`；未同意、已撤回或重大版本待重新同意时，不得创建外部请求。服务端对选中片段执行不可配置的秘密检测与掩码，并在 `ai_runs.outbound_payload_hash` 中记录实际发送内容哈希（PRD §10、PD-003、ADD §17.2）。

## 6. 统一需求工程核心

以下表使用显式类型、外键和枚举约束描述物理契约。涉及正式事实的行不能只靠自由文本，必须通过关系表关联证据。多态关系无法由 SQLite 外键直接覆盖的部分按 §6.4 的 Repository 与完整性门禁执行。

### 6.1 角色、工作和成果

```text
stakeholders(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, role TEXT NOT NULL,
  influence TEXT NULL, interest TEXT NULL, authority TEXT NULL,
  contact_scope TEXT NULL, notes TEXT NULL,
  epistemic_type TEXT NOT NULL CHECK (epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
  status TEXT NOT NULL CHECK (status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

jobs(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  stakeholder_id TEXT NULL REFERENCES stakeholders(id) ON DELETE RESTRICT,
  context TEXT NOT NULL, job_statement TEXT NOT NULL,
  pain TEXT NULL, current_workaround TEXT NULL, expected_progress TEXT NULL,
  epistemic_type TEXT NOT NULL CHECK (epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
  status TEXT NOT NULL CHECK (status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

drivers(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  driver_type TEXT NOT NULL CHECK (driver_type IN ('goal','outcome','obligation','risk','problem','opportunity')),
  statement TEXT NOT NULL,
  owner_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

outcomes(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  driver_id TEXT NOT NULL UNIQUE REFERENCES drivers(id) ON DELETE RESTRICT,
  job_id TEXT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  description TEXT NOT NULL, success_metric TEXT NULL,
  baseline_value TEXT NULL, target_value TEXT NULL, unit TEXT NULL,
  failure_condition TEXT NULL,
  horizon TEXT NULL CHECK (horizon IS NULL OR horizon IN ('now','next','later','watch')),
  owner_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  epistemic_type TEXT NOT NULL CHECK (epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
  status TEXT NOT NULL CHECK (status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

capabilities(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, description TEXT NULL,
  parent_capability_id TEXT NULL REFERENCES capabilities(id) ON DELETE RESTRICT,
  epistemic_type TEXT NOT NULL CHECK (epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
  status TEXT NOT NULL CHECK (status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

interview_turns(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
  role TEXT NOT NULL CHECK (role IN ('interviewer','stakeholder','system')),
  stakeholder_id TEXT NULL REFERENCES stakeholders(id) ON DELETE RESTRICT,
  speaker_label TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence_span_id TEXT NULL REFERENCES evidence_spans(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, turn_index)
)
```

Outcome 是 Driver 的一个具体类型——只有 `drivers.driver_type = 'outcome'` 的 Driver 才允许在 `outcomes` 表中有对应的扩展记录。

**约束与语义**：

- `outcomes.driver_id UNIQUE`：一个 Driver 最多有一个 Outcome 扩展。这保证了每个可度量的成果有且仅有一组指标。
- **写入时校验**：Repository 在插入前必须验证 `drivers.driver_type = 'outcome'`。若 Driver 类型为 `goal | obligation | risk | problem | opportunity`，则拒绝创建 Outcome 记录，返回 `DRIVER_TYPE_MISMATCH`。
- `goal` 等非 outcome 类型的 Driver 如需表达度量信息（如假设的基线值），使用 Driver 自身的 `statement` 字段或追踪链，不通过 `outcomes` 表扩展。
- `outcomes.job_id` 保留常见 `Stakeholder → Job → Outcome` 关系；一个 Outcome 涉及多个 Job 时额外使用 TraceLink。
- 指标和失败条件在候选阶段允许为空，但进入已确认范围前必须满足成果门禁。
- `interview_turns` 保存正式项目访谈轮次，支持 FSD 恢复访谈流和从访谈语句跳转证据；它不同于快速问诊 `quick_turns`，只属于正式项目。`evidence_span_id` 非空时必须属于同项目 Source；为空表示手工访谈记录或尚未落入证据片段。

### 6.2 需求、验收和观测

```text
requirements(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requirement_key TEXT NOT NULL, title TEXT NULL, statement TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('explicitly_stated','derived','assumed','proposed')),
  horizon TEXT NULL CHECK (horizon IS NULL OR horizon IN ('now','next','later','watch')),
  scope_disposition TEXT NOT NULL DEFAULT 'included' CHECK (scope_disposition IN ('included','excluded')),
  commitment TEXT NOT NULL CHECK (commitment IN ('committed','conditional','scenario','speculation')),
  stability TEXT NOT NULL CHECK (stability IN ('stable','policy-variable','experimental')),
  priority TEXT NULL, valid_from TEXT NULL, valid_until TEXT NULL,
  activation_trigger TEXT NULL, deactivation_trigger TEXT NULL,
  volatility_drivers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(volatility_drivers_json)),
  migration_strategy TEXT NULL CHECK (migration_strategy IS NULL OR migration_strategy IN ('coexist','transform','replace','retire')),
  reversibility TEXT NULL CHECK (reversibility IS NULL OR reversibility IN ('high','medium','low')),
  owner_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supersedes_requirement_id TEXT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('candidate','supported','reviewed','accepted','implemented','verified','superseded','retired')),
  rationale TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id, requirement_key),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
)

requirement_driver_links(
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (relation IN ('motivated_by','constrains','mitigates','realizes')),
  rationale TEXT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(requirement_id, driver_id, relation)
)

acceptance_criteria(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  context TEXT NULL, action_or_condition TEXT NOT NULL, expected_result TEXT NOT NULL,
  measurement_method TEXT NULL, evidence_type TEXT NULL,
  threshold_value TEXT NULL, unit TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','reviewed','accepted','verified','superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

verification_artifacts(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  acceptance_criterion_id TEXT NULL REFERENCES acceptance_criteria(id) ON DELETE RESTRICT,
  artifact_type TEXT NOT NULL, description TEXT NULL,
  source_id TEXT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  artifact_path TEXT NULL, result TEXT NULL,
  executed_at TEXT NULL, verified_by TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('planned','available','passed','failed','invalidated')),
  created_at TEXT NOT NULL,
  CHECK (source_id IS NOT NULL OR artifact_path IS NOT NULL OR result IS NOT NULL)
)

operational_signals(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, measurement TEXT NOT NULL,
  threshold_value TEXT NULL, unit TEXT NULL, observation_window TEXT NULL,
  owner_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_cadence TEXT NULL, trigger_condition TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused','retired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)
```

Requirement 是规范性陈述，使用 `provenance`，不能标记为 Fact。`As-Is` 保存在 Job、Pain 和 Workaround 等现状实体中，不进入 `requirements.horizon`；“不做”保存为 `scope_disposition='excluded'`。Driver、Evidence 和 Acceptance 分别通过 `requirement_driver_links`、EvidenceLink 和 `acceptance_criteria` 维护。`supersedes_requirement_id` 处理常见单前驱替代，复杂多对多替代仍使用 TraceLink。horizon、scope_disposition、commitment 和 lifecycle_status 不得互相推导覆盖。`requirement_type` 是领域配置控制词表（例如 functional、performance、compliance），不在核心库硬编码 CHECK；Repository 写入时必须根据当前 DomainProfile/Pack 的允许值校验，并把使用的领域配置版本记录进报告和基线快照。

### 6.3 未知、假设、冲突、方案与决策

```text
unknowns(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  question TEXT NOT NULL, information_value TEXT NULL, impact TEXT NULL,
  owner_id TEXT NULL REFERENCES users(id), due_at TEXT NULL, resolution_condition TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','investigating','resolved','closed')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

assumptions(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  statement TEXT NOT NULL, validation_plan TEXT NULL,
  owner_id TEXT NULL REFERENCES users(id), due_at TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','testing','validated','invalidated','retired')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

conflicts(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  statement TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  blocking INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0,1)),
  owner_id TEXT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('open','deciding','resolved','accepted_risk')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

conflict_sides(
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  statement TEXT NOT NULL,
  stance TEXT NOT NULL,
  evidence_link_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_link_ids_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

conflict_options(
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id) ON DELETE RESTRICT,
  description TEXT NOT NULL, benefits TEXT NULL, costs TEXT NULL, risks TEXT NULL,
  reversibility TEXT NULL CHECK (reversibility IS NULL OR reversibility IN ('high','medium','low')),
  status TEXT NOT NULL CHECK (status IN ('candidate','selected','rejected','withdrawn')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

decisions(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  conflict_id TEXT NULL REFERENCES conflicts(id), question TEXT NOT NULL,
  selected_option_id TEXT NULL, rationale TEXT NULL,
  decided_by TEXT NULL REFERENCES users(id), decided_at TEXT NULL,
  review_trigger TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','decided','superseded','revoked')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

future_scenarios(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, description TEXT NOT NULL,
  probability_class TEXT NULL CHECK (probability_class IS NULL OR probability_class IN ('low','medium','high','unknown')),
  activation_trigger TEXT NOT NULL,
  leading_indicators_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(leading_indicators_json)),
  horizon TEXT NOT NULL CHECK (horizon IN ('next','later','watch')),
  architecture_response TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','triggered','retired')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)
```

`conflict_sides` 和 `conflict_options` 是冲突详情页的只读来源。`decisions.selected_option_id` 由迁移创建指向 `conflict_options(id)` 的延迟外键，并校验该选项属于同一个 `decisions.conflict_id`。决策只引用候选方案，不拥有候选方案；Conflict 通过 `decisions.conflict_id` 连接决策。`decisions.decided_by` 必须是当时有效 Reviewer/Owner。`blocking=1` 且未 resolved/accepted_risk 的冲突阻止基线批准和报告发布。

### 6.4 证据与追踪关系

```text
evidence_links(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  evidence_span_id TEXT NOT NULL REFERENCES evidence_spans(id),
  relation TEXT NOT NULL CHECK (relation IN ('supports','contradicts','qualifies','originates')),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, evidence_span_id, relation)
)

trace_links(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_type TEXT NOT NULL, from_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','superseded','invalidated')),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, from_type, from_id, relation, to_type, to_id)
)
```

SQLite 无法对多态 ID 建普通外键，由 Repository 和完整性门禁共同保证：

**写入时验证（Repository，同事务）**：

1. 根据 `entity_type` 查允许的实体类型白名单——`evidence_links` 允许 `stakeholders | jobs | drivers | outcomes | capabilities | requirements | assumptions | unknowns | conflicts | decisions`；`trace_links` 允许所有核心实体类型；
2. 按 `entity_type` 路由到对应表，执行 `SELECT 1 FROM <table> WHERE id = ? AND project_id = ?`，验证实体存在且属于同一项目；
3. `evidence_links` 还须验证 `evidence_span_id` 对应的 `sources.project_id` 与当前 `project_id` 一致；
4. 任一步失败 → 事务回滚，返回 `EVIDENCE_NOT_FOUND` 或 `VALIDATION_ERROR`。

**发布前完整性检查（独立命令，非事务）**：

```text
FOR each evidence_link:
  IF entity_type/entity_id 对应实体不存在或 project_id 不一致 → 报告孤儿引用
FOR each trace_link:
  IF from_id 或 to_id 对应实体不存在或 project_id 不一致 → 报告断裂追踪链
```

检查在报告发布前和基线批准前强制执行；发现孤儿关系时阻止发布，不静默修复。

夜间完整性任务作为补充保障：重新扫描所有多态关系，发现孤儿后写入告警日志并通知项目 Owner。该任务不自动删除数据，由人工决定是补全引用还是标记为已废弃。

## 7. 评审、版本与基线

### 7.1 `review_actions`

```text
id TEXT PRIMARY KEY
project_id TEXT NOT NULL REFERENCES projects(id)
gate TEXT NULL CHECK (gate IS NULL OR gate IN ('outcome','evidence_conflict','scope','domain_profile','report_release'))
entity_type TEXT NOT NULL
entity_id TEXT NOT NULL
entity_version INTEGER NOT NULL
action TEXT NOT NULL CHECK (action IN ('accept','modify','reject','uncertain'))
before_value TEXT NULL CHECK (before_value IS NULL OR json_valid(before_value))
after_value TEXT NULL CHECK (after_value IS NULL OR json_valid(after_value))
reviewer_id TEXT NOT NULL REFERENCES users(id)
reason TEXT NOT NULL
follow_up_json TEXT NULL CHECK (follow_up_json IS NULL OR json_valid(follow_up_json))
created_at TEXT NOT NULL
```

此表只追加。应用事务验证 Reviewer/Owner 权限和 `entity_version`，AI Job 服务账号没有确认能力。`gate` 字段包含两类语义：`outcome/evidence_conflict/scope` 是正式项目三个人工关口，对应 OpenAPI `GateType` 路径枚举；`domain_profile/report_release` 是复用同一审计表记录的领域画像和报告发布复核，不开放到 `/projects/:id/gates/:gate/reviews` 路径枚举。

### 7.2 需求版本与基线

```text
requirement_versions(
  id TEXT PRIMARY KEY, requirement_id TEXT REFERENCES requirements(id),
  version INTEGER, snapshot_json TEXT, snapshot_hash TEXT,
  changed_by TEXT REFERENCES users(id), change_reason TEXT, created_at TEXT,
  UNIQUE(requirement_id, version)
)

baselines(
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  baseline_version INTEGER NOT NULL CHECK (baseline_version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft','approved','superseded')),
  approved_by TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TEXT NULL,
  data_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, baseline_version)
)

baseline_items(
  baseline_id TEXT REFERENCES baselines(id), entity_type TEXT,
  entity_id TEXT, entity_version INTEGER, snapshot_hash TEXT,
  PRIMARY KEY(baseline_id, entity_type, entity_id)
)
```

批准基线时冻结 `baseline_items` 和哈希。报告只能从指定基线及其固定实体版本读取，不能用当前可变行重建历史。

## 7A. 待办任务

正式项目中的待确认项必须有责任人（PRD §10.4、PRD-TASK-001）。责任人可以接受、拒绝或请求重新分配；到期未处理的任务进入 `overdue`，不自动视为同意，也不由 AI 代办。

### 7A.1 `tasks`

```text
id TEXT PRIMARY KEY
project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
entity_type TEXT NOT NULL
entity_id TEXT NOT NULL
assignee_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
due_at TEXT NULL
status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','overdue','rejected','reassigned'))
priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','blocking'))
created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
completed_at TEXT NULL
version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
```

约束：

- `entity_type` 取值为 `'intake'`、`'driver'`、`'requirement'`、`'review'`、`'report'`、`'change'`，标识待办关联的实体类型；`entity_id` 为对应实体 ID，由应用层校验存在性与同项目归属；
- `assignee_id` 必须是当时有效的项目成员且具备相应能力；责任人被禁用、移出项目或失去 Reviewer 能力后，尚未完成的任务必须重新分配，既有历史确认仍保留当时身份；
- `status='overdue'` 由到期检查写入；阻断任务（`priority='blocking'`）逾期继续阻止相关关口，非阻断任务逾期可以继续草稿分析但必须可见；
- 逾期和无人负责的任务**不能自动通过关口**；AI 不得代办任务（PRD-TASK-001）；
- 并发版本冲突时用户可查看最新版本、对比自己的修改、放弃修改或基于最新版本重新应用；正式确认不能自动合并（乐观并发见 §11）；
- 真实 HTTP 试点首期只要求站内待办和状态提示，不承诺邮件、短信或企业 IM 通知。

## 8. 变化与影响

```text
change_previews(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  baseline_id TEXT NOT NULL REFERENCES baselines(id), scenario_json TEXT NOT NULL CHECK (json_valid(scenario_json)),
  status TEXT NOT NULL CHECK (status IN ('draft','analyzing','ready','failed','expired')),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NULL
)

changes(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL, description TEXT NOT NULL,
  trigger_type TEXT NULL, occurred_at TEXT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed','analyzing','reviewing','baselined','withdrawn','superseded')),
  confirmed_by TEXT NULL REFERENCES users(id), confirmed_at TEXT NULL,
  withdrawn_by TEXT NULL REFERENCES users(id), withdrawn_at TEXT NULL, withdrawal_reason TEXT NULL,
  supersedes_change_id TEXT NULL REFERENCES changes(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (status <> 'withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL))
)

change_impacts(
  id TEXT PRIMARY KEY, change_id TEXT NULL REFERENCES changes(id),
  preview_id TEXT NULL REFERENCES change_previews(id),
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, impact_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  recommended_action TEXT NULL,
  required_stage TEXT NULL CHECK (required_stage IS NULL OR required_stage IN ('interview','outcome','decision','scope','report')),
  rationale TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate','reviewed','accepted','dismissed')),
  CHECK ((change_id IS NULL) <> (preview_id IS NULL))
)
```

预演表不能成为正式基线输入。确认真实变化、项目转入 `Changing`、创建影响项和必要阶段重开任务在同一事务完成。尚未进入新基线的错误 Change 可以转为 `withdrawn`，但不能删除；一旦被 `baseline_items` 或发布报告引用，只能新增纠正 Change。

## 9. AI 作业与调用

```text
ai_jobs(
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('formal_project','quick_session','training_attempt')),
  project_id TEXT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  quick_session_id TEXT NULL REFERENCES quick_sessions(id) ON DELETE CASCADE,
  training_attempt_id TEXT NULL REFERENCES training_attempts(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)), input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','validating','retry_wait','succeeded','failed','manual_review','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0), next_run_at TEXT NULL,
  locked_by TEXT NULL, locked_at TEXT NULL, last_error_code TEXT NULL,
  cancellation_reason TEXT NULL,
  cancelled_by_kind TEXT NULL CHECK (cancelled_by_kind IS NULL OR cancelled_by_kind IN ('user','guest','system')),
  cancelled_by_user_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_by_guest_session_id TEXT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT,
  cancelled_at TEXT NULL,
  idempotency_record_id TEXT NULL REFERENCES idempotency_records(id),
  dedupe_key TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user','guest')),
  created_by_user_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_guest_session_id TEXT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((scope_kind='formal_project' AND project_id IS NOT NULL AND quick_session_id IS NULL AND training_attempt_id IS NULL)
      OR (scope_kind='quick_session' AND project_id IS NULL AND quick_session_id IS NOT NULL AND training_attempt_id IS NULL)
      OR (scope_kind='training_attempt' AND project_id IS NULL AND quick_session_id IS NULL AND training_attempt_id IS NOT NULL)),
  CHECK ((created_by_kind='user' AND created_by_user_id IS NOT NULL AND created_by_guest_session_id IS NULL)
      OR (created_by_kind='guest' AND created_by_user_id IS NULL AND created_by_guest_session_id IS NOT NULL)),
  CHECK (scope_kind <> 'formal_project' OR created_by_kind='user'),
  CHECK ((cancelled_by_kind IS NULL AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NULL)
      OR (cancelled_by_kind='user' AND cancelled_by_user_id IS NOT NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NOT NULL)
      OR (cancelled_by_kind='guest' AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NOT NULL AND cancelled_at IS NOT NULL)
      OR (cancelled_by_kind='system' AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NOT NULL))
)

ai_runs(
  id TEXT PRIMARY KEY, ai_job_id TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE, attempt INTEGER NOT NULL CHECK (attempt > 0),
  provider TEXT, model TEXT, model_revision TEXT NULL,
  thinking_mode TEXT, reasoning_effort TEXT, prompt_version TEXT,
  schema_version TEXT, domain_profile_id TEXT NULL REFERENCES domain_profiles(id) ON DELETE RESTRICT,
  domain_profile_version INTEGER NULL,
  domain_pack_versions_json TEXT, dataset_version TEXT NULL,
  input_hash TEXT, outbound_payload_hash TEXT NULL,
  input_tokens INTEGER NULL, output_tokens INTEGER NULL,
  raw_audit_blob_id TEXT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
  raw_audit_class TEXT NOT NULL DEFAULT 'final_output' CHECK (raw_audit_class IN ('none','final_output','debug_with_reasoning')),
  raw_audit_expires_at TEXT NULL,
  parsed_output_json TEXT NULL CHECK (parsed_output_json IS NULL OR json_valid(parsed_output_json)),
  status TEXT NOT NULL CHECK (status IN ('running','validating','succeeded','failed','cancelled')),
  started_at TEXT NOT NULL, completed_at TEXT NULL,
  CHECK ((domain_profile_id IS NULL AND domain_profile_version IS NULL)
      OR (domain_profile_id IS NOT NULL AND domain_profile_version IS NOT NULL)),
  UNIQUE(ai_job_id, attempt)
)

agent_runs(
  id TEXT PRIMARY KEY,
  ai_job_id TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('quick','formal','training')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled')),
  input_hash TEXT NOT NULL,
  output_hash TEXT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NULL
)

skill_runs(
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('routing','elicitation','structuring','validation','decisioning','composition')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','skipped','cancelled')),
  input_hash TEXT NOT NULL,
  output_hash TEXT NULL,
  input_schema_version TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NULL,
  model TEXT NULL,
  thinking_mode TEXT NULL,
  input_tokens INTEGER NULL,
  output_tokens INTEGER NULL,
  error_code TEXT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NULL,
  UNIQUE(agent_run_id, step_index)
)
```

Job 去重使用三个部分唯一索引，避免 SQLite 的 `NULL` 语义绕过约束：

```sql
CREATE UNIQUE INDEX uq_ai_job_formal_dedupe
ON ai_jobs(project_id, task_type, dedupe_key) WHERE scope_kind='formal_project';
CREATE UNIQUE INDEX uq_ai_job_quick_dedupe
ON ai_jobs(quick_session_id, task_type, dedupe_key) WHERE scope_kind='quick_session';
CREATE UNIQUE INDEX uq_ai_job_training_dedupe
ON ai_jobs(training_attempt_id, task_type, dedupe_key) WHERE scope_kind='training_attempt';
```

HTTP 幂等只由 `idempotency_records` 管理；AI Job 的 `dedupe_key` 仅用于避免相同固定任务重复付费，两者语义不得混用。Worker 通过短事务原子领取 Job；锁超时后转入 `retry_wait`。模型输出完成后先进入 `validating`，确定性校验通过才进入 `succeeded`。API 轮询中的 `progress/current_step/completed_at/duration_ms` 是服务端计算投影：`progress/current_step` 由状态和任务类型映射，`completed_at` 优先取最终 `ai_runs.completed_at`，否则取终态 `ai_jobs.updated_at`，`duration_ms` 由 `created_at/completed_at` 计算，不要求在 `ai_jobs` 冗余存列。v1 无外部事件消费者，不创建 outbox。

`agent_runs` 与 `skill_runs` 是后端 Orchestrator + Skill Runtime 的审计表：`ai_jobs` 仍是客户端轮询和队列生命周期单位，`agent_runs` 记录本次 Job 选择的 `agent_id/plan_id/plan_version`，`skill_runs` 记录固定 AgentPlan 中每个 Skill 的版本、分类、Schema、Prompt、模型和错误码。一个 SkillRun 可以产生 0 到多个 `ai_runs`；首期实现可以先用 `skill_runs.model` 记录主模型并通过 `ai_runs.ai_job_id` 关联到同一个 Job，后续需要更细粒度追踪时再增加 `skill_run_id` 外键。Agent/Skill 审计不保存业务正文，正文仍遵守输入最小化、审计 blob、保留期和删除任务规则。

默认不保存供应商推理内容。`final_output` 审计 blob 只保存任务所需的结构化最终输出，默认保留 30 天；`debug_with_reasoning` 需 Owner 明确启用、加密存储、仅安全管理员可读，最长 7 天，到期由可审计清理任务删除。输入正文通过 Source/Evidence 引用，不复制到普通日志。

## 10. 报告、模板与发布快照

```text
report_templates(
  id TEXT, audience TEXT NOT NULL, version TEXT, content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','deprecated')), created_at TEXT NOT NULL,
  PRIMARY KEY(id, version)
)

report_snapshots(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  report_version INTEGER NOT NULL CHECK (report_version > 0), baseline_id TEXT NOT NULL REFERENCES baselines(id),
  data_hash TEXT NOT NULL, template_id TEXT NOT NULL, template_version TEXT NOT NULL,
  core_schema_version TEXT NOT NULL, report_input_schema_hash TEXT NOT NULL,
  compiler_version TEXT NOT NULL,
  domain_profile_id TEXT NOT NULL REFERENCES domain_profiles(id),
  domain_profile_version INTEGER NOT NULL, domain_pack_versions_json TEXT NOT NULL CHECK (json_valid(domain_pack_versions_json)),
  prompt_versions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prompt_versions_json)),
  model_versions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(model_versions_json)),
  audience TEXT NOT NULL, language TEXT NOT NULL,
  file_blob_id TEXT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
  file_sha256 TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','gate_failed','rendering','staged','ready','released','publish_failed','superseded')),
  generated_at TEXT NOT NULL, released_by TEXT NULL REFERENCES users(id),
  released_at TEXT NULL, supersedes_report_id TEXT NULL REFERENCES report_snapshots(id),
  UNIQUE(project_id, report_version),
  FOREIGN KEY(template_id, template_version) REFERENCES report_templates(id, version)
)

report_gate_results(
  id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES report_snapshots(id),
  gate_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed','warning')),
  defects_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(defects_json)), checked_at TEXT NOT NULL,
  UNIQUE(report_id, gate_code)
)
```

`released` 要求 `file_blob_id/file_sha256`、全部门禁、确认身份和时间齐全。文件系统不能参与 SQLite 事务：先渲染临时文件并 fsync/计算哈希，登记 `staged` blob，原子重命名后再用短事务转 `released`。崩溃恢复检查 blob 实体和文件哈希；文件缺失时转 `publish_failed`，绝不显示已发布。已发布快照不可修改。

## 11. 幂等、并发和事务边界

通用幂等记录：

```text
idempotency_records(
  id TEXT PRIMARY KEY,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','guest')),
  actor_id TEXT NOT NULL, endpoint TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, response_status INTEGER NULL, response_json TEXT NULL,
  resource_type TEXT NULL, resource_id TEXT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  UNIQUE(actor_kind, actor_id, endpoint, idempotency_key)
)
```

约束：

- `actor_kind` 区分用户和游客；`actor_id` 为 `users.id` 或 `guest_sessions.id`，由应用层根据 `actor_kind` 校验；
- 游客请求的幂等键与用户请求分开管理。

必须使用单事务的命令：

1. 创建项目 + Owner 成员 + 初始 intake + 幂等结果；
2. 对象修改 + 版本快照 + review/change 审计；
3. 人工关口动作 + 状态转换 + 待核实项；
4. 基线冻结 + items + 数据哈希；
5. 真实变化确认 + 项目状态 + impacts + 阶段重开任务；
6. 报告门禁结果和数据库发布状态转换。文件写入按 §10 的可恢复状态机在事务外完成。
7. 快速问诊升级命令（ADR-022、§11.5）：创建正式 `projects` + `project_members(Owner)` + `project_intakes(source_quick_session_id)` + 复制候选（`quick_sessions` 内容按候选状态迁移，不复制确认状态/基线）+ `upgrade_records(started→succeeded)` + 标记 `quick_sessions.status='upgraded'`。任一步失败完全回滚，保持 `quick_sessions` 状态为 `brief_ready`；同一 `idempotency_key` 重试返回首次结果，不创建第二个项目。

乐观并发使用：

```sql
UPDATE projects
SET name = ?, version = version + 1, updated_at = ?
WHERE id = ? AND version = ?;
```

影响行数为 0 时返回 `VERSION_CONFLICT`，不做后续副作用。

升级命令失败回滚约束：

- 失败后不得留下用户可见的半成品项目、重复候选或错误 `upgraded` 状态；
- 失败后快速会话保持 `brief_ready`，用户输入和简报不丢失，可以安全重试；
- 升级成功后，快速问诊与正式项目通过只读来源关系关联（`project_intakes.source_quick_session_id`），二者后续版本分别演化；
- 若创建后发现业务错误，只能归档/纠正正式项目并保留审计，不能删除升级来源关系后伪装未发生。

## 11A. 产品埋点事件

埋点用于验证产品流程和假设，不作为业务事实、需求证据、员工绩效或训练认证依据（PRD §12.5、ADD §18.3、PRD-ANALYTICS-001）。业务审计日志与产品分析事件必须分开存储和授权。

### 11A.1 `product_events`

```text
id TEXT PRIMARY KEY
event_id TEXT NOT NULL UNIQUE
event_name TEXT NOT NULL
event_schema_version TEXT NOT NULL
occurred_at TEXT NOT NULL
received_at TEXT NULL
environment TEXT NOT NULL CHECK (environment IN ('demo','development','test','pilot','production'))
app_version TEXT NOT NULL
mode TEXT NOT NULL CHECK (mode IN ('quick','formal','training','entry'))
source_kind TEXT NOT NULL CHECK (source_kind IN ('custom','sample','training_fixture','internal_test'))
analytics_session_id TEXT NOT NULL
actor_key TEXT NULL
stage TEXT NULL
experiment_id TEXT NULL
attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes_json))
created_at TEXT NOT NULL
expires_at TEXT NOT NULL
```

约束：

- `event_id` 为客户端或服务端生成的唯一事件 ID，用于去重；全局唯一；同一业务命令重试不得重复计入成功指标；
- `event_name` 来自 PRD §12.5 注册表的稳定名称（P0：`mode_selected`、`agreement_action`、`identity_action`、`quick_session_started`、`coverage_slot_changed`、`question_interaction`、`understanding_reviewed`、`topic_change_resolved`、`option_preference_recorded`、`brief_generated`、`brief_viewed`、`brief_exported`、`brief_usefulness_feedback`、`quick_session_abandoned`、`upgrade_result`、`error_presented`、`recovery_action`；P1：`formal_stage_entered`、`formal_gate_action`、`report_result`、`change_action`；P2：`training_attempt_started`、`training_question_asked`、`training_summary_submitted`、`training_feedback_viewed`、`training_attempt_completed`）；
- `received_at` 真实 HTTP 链路起填，用于识别离线补发和时钟异常；客户端时间与服务端接收时间差异超阈值时标记时钟异常；
- `mode` 起始页事件可为 `entry`；`source_kind` 区分 `custom`、`sample`、`training_fixture`、`internal_test`；
- `analytics_session_id` 是对应 PRD 逻辑字段 `session_key` 的非秘密分析会话 ID，不得等于、包含或由游客认证令牌直接派生；`actor_key` 为匿名或假名化用户键，不得使用邮箱、电话或姓名；
- `stage` 为当前业务步骤或正式项目章节；`experiment_id` 没有实验时不传；
- `attributes_json` 按 `event_name + event_schema_version` 的注册 Schema 校验，承载 `action`、`rating`、`result`、`brief_version`、`elapsed_ms` 等事件专属字段；缺少必填字段、出现未知字段或命中禁止字段时拒绝整条事件；
- 事件必须携带 `event_schema_version`，未知版本进入隔离而不是静默解析；事件 Schema 变更需要兼容期和回归测试，不允许直接复用旧事件名改变语义；
- 埋点失败不得阻断用户主流程，离线补发要去重并设置上限；
- **禁止字段**（由应用层 Schema 校验）：任何事件都不得包含原始需求文本、用户回答正文、材料片段、文件名、Prompt、模型完整输入输出、姓名、邮箱、电话、证件信息或协议正文。需要分析内容质量时使用受控评估集和人工量表；
- `expires_at` 默认 90 天；原始事件和去标识化汇总指标分别执行 §9.5 的保留期；撤回同意不新增 AI 事件，删除请求完成后分析系统不得继续保留可关联到该用户的明细事件；
- Demo、内部测试、样例、自定义真实会话分层统计，默认产品指标排除 `internal_test`。

## 11B. 实体变更审计

业务表自带的操作者字段（`created_by`、`updated_at`、`version` 等）和 `idempotency_records` 覆盖了"谁在何时以何幂等键做了何命令"级别审计。对于需要字段级前后值追踪的关键实体，补充统一变更审计表，支持合规审查、问题回溯和影响分析，不替代业务表自身的版本管理。

### 11B.1 `entity_change_logs`

```text
id TEXT PRIMARY KEY
entity_type TEXT NOT NULL CHECK (entity_type IN (
  'project','project_member','project_intake','baseline','requirement',
  'driver','review_action','report_snapshot','change',
  'quick_session','brief_version','brief_export','option_preference',
  'upgrade_record','training_attempt','training_feedback',
  'agreement_version','agreement_consent','guest_session','task'
))
entity_id TEXT NOT NULL
project_id TEXT NULL REFERENCES projects(id) ON DELETE RESTRICT  -- 正式项目相关实体填写，便于项目级审计查询
quick_session_id TEXT NULL REFERENCES quick_sessions(id) ON DELETE SET NULL  -- 删除快速正文后保留最小审计事实
change_kind TEXT NOT NULL CHECK (change_kind IN ('created','updated','state_changed','deleted','archived','restored'))
actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','guest','system'))
actor_id TEXT NOT NULL  -- user_id、guest_session_id 或 'system'
field_changes_json TEXT NULL CHECK (field_changes_json IS NULL OR json_valid(field_changes_json))
  -- 仅 change_kind='updated'/'state_changed' 时填写，格式：[{field, old_value, new_value, reason}]
  -- 敏感字段（原始需求文本、回答正文、材料片段、Prompt、模型 IO、姓名、邮箱、电话、证件、协议正文）不得写入，以 '<redacted>' 占位
before_state_hash TEXT NULL  -- 变更前对象快照哈希，用于校验而非还原正文
after_state_hash TEXT NULL
idempotency_key TEXT NULL  -- 关联触发本次变更的幂等命令，可空（系统自动变更无幂等键）
occurred_at TEXT NOT NULL
received_at TEXT NULL  -- 异步写入时记录入库时间
```

索引：

```text
entity_change_logs(entity_type, entity_id, occurred_at DESC)
entity_change_logs(project_id, occurred_at DESC) WHERE project_id IS NOT NULL
entity_change_logs(quick_session_id, occurred_at DESC) WHERE quick_session_id IS NOT NULL
entity_change_logs(actor_kind, actor_id, occurred_at DESC)
entity_change_logs(idempotency_key) WHERE idempotency_key IS NOT NULL
```

约束：

- 审计写入与业务写入在同一事务内完成，不另起事务；业务事务回滚时审计一并回滚，不产生"未变更但有审计"的孤儿记录；
- `field_changes_json` 只记录受控字段的前后值；敏感字段以 `<redacted>` 占位，详细内容在业务表自身版本链中追踪；
- `before_state_hash`/`after_state_hash` 为对象快照（不含敏感字段）的 SHA-256，用于快速比对和一致性校验，不用于还原正文；
- 删除操作（`change_kind='deleted'`）只记录删除事实和审计引用，不记录被删正文；正文保留由 §14 分层保留策略管理；
- 系统自动变更（如 Job 重试、过期清理、状态机自动推进）`actor_id='system'`，并在 `field_changes_json.reason` 说明触发来源；
- 审计记录默认保留 2 年（对齐 §14.2 协议同意/撤回保留期），法律保留期间不得物理删除；
- 审计查询需具备项目能力或管理员权限；普通用户只能查看自己 `actor_id` 的审计记录；
- `entity_change_logs` 与 `product_events` 分离：前者是字段级业务审计，后者是产品流程埋点；两者存储、授权和保留期不同。

### 11B.2 审计覆盖范围

以下实体变更必须写入 `entity_change_logs`：

| 实体类型 | 必须审计的 change_kind | 说明 |
|---|---|---|
| `project` | created, updated, state_changed, deleted, archived | 项目状态机和项目属性变更 |
| `project_member` | created, updated, deleted | 成员能力和角色变更 |
| `baseline` | created, state_changed | 基线批准和状态变更 |
| `requirement` | created, updated, state_changed | 需求状态、范围处置和验收变更 |
| `review_action` | created | 关口确认记录（含否决和退回） |
| `report_snapshot` | created, state_changed | 报告发布和状态变更 |
| `change` | created, state_changed | 变更预演和确认 |
| `quick_session` | created, updated, state_changed, archived | 快速问诊状态机与指定会话认领 |
| `brief_version` | created | 简报版本生成 |
| `brief_export` | created | 简报导出 |
| `upgrade_record` | created, state_changed | 升级事务开始和完成 |
| `agreement_consent` | created, state_changed | 协议同意和撤回 |
| `guest_session` | created | 游客凭证签发；认领发生在 `quick_session` |
| `task` | created, updated, state_changed | 待办任务分配和状态变更 |

非上述实体（如 `evidence_span`、`fact`、`driver` 等分析中间产物）的变更由业务表自身版本字段和 `idempotency_records` 覆盖，不强制写入 `entity_change_logs`；如需补充可在后续版本扩展 `entity_type` 枚举。

## 12. 核心约束与发布前校验

数据库约束与应用门禁共同保证：

- `Fact` 进入 supported/accepted 前至少一个 `evidence_links.relation='supports'`；
- Evidence、Trace、Driver 和评审对象与项目一致；
- Now 需求有 Owner、至少一项验收/评价方式，并连接已确认 Driver 或批准的 Decision 链；
- 未解决阻断冲突时不能批准基线；
- DomainProfile 未批准或静态领域配置不兼容时不能发布；
- 报告内容只读取指定基线固定的实体版本；
- Watch 不自动创建当前实现任务；
- 预演数据不进入正式实体、基线或发布报告；
- AI 服务身份不能写入批准人字段；
- 快速问诊的"理解正确"不产生正式 ReviewAction，不等于正式审批、已接受需求或需求基线（§12.1）；
- 训练数据与真实项目隔离，不产生正式 Fact/Requirement/Decision/ReviewAction；训练评分只用于本次反馈，不写入真实项目状态（§12A、§12.3）；
- 三种模式状态机独立，状态不得互相冒充或映射（ADR-019）。

SQLite 不能可靠表达的跨表/多态约束由 Repository 和发布门禁实现，并提供独立完整性检查命令；检查失败阻止发布而不是静默修复。

## 12A. 表达训练

表达训练为试验模式（P2，ADR-019、§0.6、§12.3、PRD §7），训练用户主动发现信息缺口、提出有效问题并形成准确摘要。训练状态机 `not_started → interviewing → summarizing → feedback_ready → retrying/completed` 独立于其他模式。训练数据必须与真实项目隔离，AI 扮演角色时只使用案例允许披露的信息。

当前实现已落地训练基础五表、基础 Repository 和训练专用 `training_turns`。真实训练 Runtime 使用 `training_turns` 恢复用户追问、角色回答和教练提示；隐藏案例信息仍由后端私有读取，不返回浏览器。这些扩展不写入快速问诊或正式项目表，浏览器验收和后续演进见 [08-expression-training-development-plan.md](./08-expression-training-development-plan.md)。

### 12A.1 `training_cases`

```text
id TEXT PRIMARY KEY
case_id TEXT NOT NULL
version TEXT NOT NULL
title TEXT NOT NULL
difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard'))
scenario_json TEXT NOT NULL CHECK (json_valid(scenario_json))
disclosure_rules_json TEXT NOT NULL CHECK (json_valid(disclosure_rules_json))
rubric_json TEXT NOT NULL CHECK (json_valid(rubric_json))
status TEXT NOT NULL CHECK (status IN ('draft','active','deprecated'))
created_at TEXT NOT NULL
UNIQUE(case_id, version)
```

约束：

- `case_id` 为案例逻辑 ID；`version` 如 "1.0.0"；同一逻辑案例可有多个版本；
- `difficulty` 区分易、中、难；案例至少覆盖软件/网页项目、学习或课程项目、设计与内容任务、服务流程或活动方案、信息不足/目标冲突/方案先行的困难案例（PRD §7.3）；
- `scenario_json` 包含案例场景与可披露信息；`disclosure_rules_json` 定义用户问到对应信息时才逐步披露的规则；`rubric_json` 为透明量表，评分有依据、有遗漏和改进说明；
- `status='active'` 的案例可用于训练；`deprecated` 案例不再开新 attempt 但保留历史；
- 训练案例不进入真实项目证据。

### 12A.2 `training_attempts`

```text
id TEXT PRIMARY KEY
case_id TEXT NOT NULL
case_version TEXT NOT NULL
user_id TEXT NULL REFERENCES users(id) ON DELETE RESTRICT
guest_session_id TEXT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT
status TEXT NOT NULL CHECK (status IN ('not_started','interviewing','summarizing','feedback_ready','retrying','completed'))
started_at TEXT NOT NULL
completed_at TEXT NULL
attempt_number INTEGER NOT NULL CHECK (attempt_number > 0)
created_at TEXT NOT NULL
version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
CHECK ((user_id IS NOT NULL AND guest_session_id IS NULL)
    OR (user_id IS NULL AND guest_session_id IS NOT NULL))
```

约束：

- 训练状态机：`not_started → interviewing → summarizing → feedback_ready → retrying/completed`（§12.3）；`retrying` 后回到 `interviewing`；
- 训练状态不得映射为正式项目状态，也不得产生正式 Fact、Requirement、Decision 或 ReviewAction；
- `feedback_ready` 后允许重新练习，保留旧反馈；`completed` 不代表权威能力认证；
- `attempt_number` 标识同一用户/会话对同一案例版本的尝试序号；
- `case_id` + `case_version` 引用 `training_cases`，但训练数据与真实项目隔离。

### 12A.3 `training_questions`

```text
id TEXT PRIMARY KEY
attempt_id TEXT NOT NULL REFERENCES training_attempts(id) ON DELETE RESTRICT
question_index INTEGER NOT NULL CHECK (question_index >= 0)
asked_at TEXT NOT NULL
disclosure_rule_hit TEXT NULL
```

约束：

- 记录本次提问路径，用于展示"已覆盖和遗漏的信息"；
- **不记录问题正文**（PRD §12.5、P2 事件 `training_question_asked`）；`question_index` 为问题序号；
- `disclosure_rule_hit` 命中的披露规则 ID，用于判断是否问到对应信息并按规则披露。

### 12A.4 `training_summaries`

```text
id TEXT PRIMARY KEY
attempt_id TEXT NOT NULL REFERENCES training_attempts(id) ON DELETE RESTRICT
version INTEGER NOT NULL CHECK (version > 0)
summary_hash TEXT NOT NULL
submitted_at TEXT NOT NULL
UNIQUE(attempt_id, version)
```

约束：

- **只存哈希，不存正文**（PRD §12.5）；`summary_hash` 用于比对用户总结与案例事实的差异；
- 同一 attempt 可有多个版本，对应重练；
- 训练总结不得写入真实项目需求或验收。

### 12A.5 `training_feedback`

```text
id TEXT PRIMARY KEY
attempt_id TEXT NOT NULL REFERENCES training_attempts(id) ON DELETE RESTRICT
coverage_score_bp INTEGER NOT NULL CHECK (coverage_score_bp >= 0 AND coverage_score_bp <= 10000)
missing_dimension_count INTEGER NOT NULL
feedback_json TEXT NOT NULL CHECK (json_valid(feedback_json))
dimension_breakdown_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dimension_breakdown_json))
improvement_examples_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(improvement_examples_json))
generated_at TEXT NOT NULL
```

约束：

- `coverage_score_bp` 为 0–10000 的整数基点，展示时换算为 0–100% 或 API `coverage_score` 的 0–1 小数投影；`missing_dimension_count` 为遗漏维度数量；
- 评分由确定性覆盖检查和受约束的 AI 反馈共同形成（PRD §7.4），评分只用于本次反馈，不宣称是权威能力认证；
- `dimension_breakdown_json` 保存逐维评分依据（`dimension/status/evidence/comment`），`improvement_examples_json` 保存可执行改写示例（`before/after/reason`），对应 API `TrainingFeedback.dimension_breakdown` 与 `improvement_examples`；
- `feedback_json` 包含评分依据、遗漏项、过早假设、诱导性问题、用户总结与案例事实差异和 2–5 条改进建议（PRD §7.5）；
- 评分**不写入真实项目状态**，不产生正式 Fact/Requirement/Decision/ReviewAction。

## 13. 索引

最低索引集：

```text
projects(owner_id, status, updated_at DESC)
project_members(user_id, status, project_id)
project_intakes(project_id, intake_version DESC)
domain_profiles(project_id, status, profile_version DESC)
project_domain_packs(project_id, status)
blobs(sha256)
sources(project_id, extraction_status, created_at DESC)
sources(project_id, blob_id)
evidence_spans(source_id, start_offset)
evidence_links(project_id, entity_type, entity_id)
trace_links(project_id, from_type, from_id)
trace_links(project_id, to_type, to_id)
outcomes(project_id, job_id, status)
drivers(project_id, driver_type, status)
requirement_driver_links(driver_id, requirement_id)
requirements(project_id, horizon, scope_disposition, lifecycle_status)
acceptance_criteria(requirement_id, status)
verification_artifacts(requirement_id, acceptance_criterion_id, status)
conflict_sides(conflict_id)
conflict_options(conflict_id, status)
future_scenarios(project_id, horizon, status)
conflicts(project_id, blocking, status)
review_actions(project_id, gate, created_at DESC)
baselines(project_id, baseline_version DESC)
changes(project_id, status, created_at DESC)
changes(project_id, source_id, occurred_at DESC)
ai_jobs(status, next_run_at, created_at)
ai_jobs(project_id, task_type, dedupe_key) WHERE scope_kind='formal_project' UNIQUE
ai_jobs(quick_session_id, task_type, dedupe_key) WHERE scope_kind='quick_session' UNIQUE
ai_jobs(training_attempt_id, task_type, dedupe_key) WHERE scope_kind='training_attempt' UNIQUE
report_snapshots(project_id, report_version DESC)
guest_sessions(session_key_digest UNIQUE)
guest_sessions(expires_at)
guest_sessions(last_active_at)
agreement_consents(user_id) WHERE user_id IS NOT NULL
agreement_consents(guest_session_id) WHERE guest_session_id IS NOT NULL
agreement_consents(agreement_version_id)
quick_sessions(guest_session_id)
quick_sessions(user_id)
quick_sessions(origin_guest_session_id)
quick_sessions(status)
quick_sessions(expires_at)
brief_versions(quick_session_id, version UNIQUE)
interview_turns(project_id, turn_index)
interview_turns(project_id, role, created_at DESC)
brief_exports(brief_version_id)
brief_exports(expires_at)
upgrade_records(quick_session_id, idempotency_key UNIQUE)
upgrade_records(target_project_id)
tasks(project_id, assignee_id, status, due_at)
product_events(event_id UNIQUE)
product_events(analytics_session_id, occurred_at)
product_events(occurred_at)
product_events(mode)
product_events(source_kind)
product_events(expires_at)
training_attempts(user_id)
training_attempts(guest_session_id)
training_attempts(case_id)
delete_tasks(target_id)
delete_tasks(status)
```

全文搜索仅对经授权的标准化文本建立 FTS5 虚表；FTS 结果是检索候选，不是证据，最终引用仍指向 EvidenceSpan。

## 14. 保留、删除、备份与恢复

本节对齐 ADD §9.5 与 PRD §10.5 的 9 类分层保留策略、删除任务和法律保留、备份与恢复重放约束。以下为产品默认值；适用法律、合同、组织政策或有效法律保留要求更严格时，以更严格者为准。覆盖默认值时必须向有权限的用户展示实际期限和原因。

### 14.1 `delete_tasks`

```text
id TEXT PRIMARY KEY
scope TEXT NOT NULL CHECK (scope IN ('quick_session','formal_project','training_attempt','user_account','expired_data','temp_export'))
target_id TEXT NOT NULL
requester_type TEXT NOT NULL CHECK (requester_type IN ('user','guest','system'))
requester_id TEXT NOT NULL
reason TEXT NULL
status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','failed','cancelled'))
legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0,1))
legal_hold_reason TEXT NULL
estimated_purge_at TEXT NULL
completed_at TEXT NULL
failure_reason TEXT NULL
audit_ref TEXT NULL
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

约束：

- `scope` 区分删除范围；`target_id` 为目标对象 ID；
- `requester_type` 区分发起方；`requester_id` 为 `users.id` 或 `guest_sessions.id`，由应用层根据 `requester_type` 校验；
- 游客可删除自己的快速问诊会话（PRD §10.5）；
- 游客删除时通过 `session_key` 认证，不要求先登录；
- `legal_hold=1` 时暂停物理删除并显示状态，有效法律保留或合同义务存在时不得物理清除；
- `legal_hold_reason` 只保存可展示的最小原因，不写入业务正文、合同原文或个人敏感信息；
- `estimated_purge_at` 为服务端计算并持久化的预计物理清除时间，供 `GET /api/delete-tasks/:id` 恢复展示；法律保留期间可为 NULL 或保持原预计时间并由 `legal_hold=1` 覆盖解释；
- 删除请求提交后，数据必须立即对普通用户和业务流程不可用，主存储在 30 天内物理清除；
- 删除任务必须记录范围、申请人、时间、执行状态和失败原因，**不记录被删除正文**；`audit_ref` 仅记录审计引用；
- 删除不能破坏仍需保留的审计关系，必须先检查法律和合同义务；
- 快速会话已升级为正式项目时，系统只删除允许删除的快速侧副本；正式项目中依法或依合同必须保留的来源快照继续保留并显示原因；
- 删除任务可重试且留审计。

### 14.2 分层保留策略（对齐 ADD §9.5 / PRD §10.5）

| 数据类别 | 默认保留期 | 删除方式 | 法律保留 |
|---|---|---|---|
| 演示链路本地草稿（浏览器） | 留在当前浏览器，直到用户清除或浏览器回收 | 提供"清除本地数据"；不上传服务端 | 不适用 |
| 空游客凭证 | 最后活动后 30 天 | 到期清理凭证摘要；不影响已认领账户数据 | 不适用 |
| 未登录快速问诊/训练会话 | 最后活动后 30 天 | 到期自动删除；登录认领后转为账户数据期限 | 认领后按账户数据期限 |
| 已登录快速问诊/训练会话 | 最后活动后 180 天 | 到期前提示；用户可提前删除 | 适用法律保留 |
| 正式项目、材料、确认、版本和已发布报告 | 保留至 Owner 发起删除或组织政策到期 | 有效法律保留或合同义务存在时暂停删除并显示状态 | 法律保留阻止物理删除 |
| 含业务正文的模型调试记录 | 默认不记录；受控排障临时开启时最多 7 天 | 到期自动清除；不得作为产品埋点长期保存 | 不适用 |
| 产品分析原始事件 | 90 天 | 到期删除；不得含 PRD §12.5 禁止字段 | 不适用 |
| 去标识化汇总指标 | 13 个月 | 到期删除或重新聚合；不得反推出个人或业务正文 | 不适用 |
| 协议同意/撤回记录 | 最后一次处理或撤回后 2 年 | 法律要求不同则按适用期限，且保留依据可审计 | 法律保留优先 |
| 服务端临时导出文件 | 24 小时 | 到期自动删除；正式报告源文件随正式项目保留 | 不适用 |

补充保留约束：

- 项目默认软归档；删除请求先评估审计、合同和法规保留义务；
- 未发布预演按配置到期删除；幂等记录默认保留 24 小时；普通调试日志不进入业务库；AI 最终输出审计默认 30 天，含推理调试审计最长 7 天；
- 原始材料、AI 审计载荷和报告文件的删除必须与数据库元数据同一删除任务协调，任务可重试且留审计；
- 发布快照依赖的材料和版本在保留期内不得被物理删除；
- 撤回同意不新增 AI 事件，删除请求完成后分析系统不得继续保留可关联到该用户的明细事件。

### 14.3 备份与恢复约束

- 每日使用 SQLite Online Backup API 生成一致性备份，同时备份 blob 目录、Schema/迁移版本、Prompt/模板/静态领域配置 manifest；
- 备份加密并设置访问控制，不包含明文密钥；
- 备份采用最多 **35 天滚动周期**并自然过期；
- 至少每季度在隔离环境恢复，校验数据库完整性、文件哈希、随机 EvidenceSpan 定位和随机报告重建输入；
- 删除请求受理事务提交前，必须同步追加写入主数据库之外的 `deletion_ledger`。账本只保存任务 ID、范围、目标标识的 HMAC、受理时间、状态和账本序号，不保存业务正文；每次追加后 fsync，并复制到与主数据库快照独立的备份目标；
- **恢复后必须重放删除记录**（防止已删数据复活）：恢复流程先读取数据库快照的备份时间/账本序号，再从最新 `deletion_ledger` 重放其后的删除任务。不能只读取被恢复数据库中的 `delete_tasks`，因为快照之后的删除记录不在旧快照内；
- 法律保留（`legal_hold=1`）阻止物理删除，恢复时仍受保留约束；
- 用户已经复制或下载到自己设备的文件无法由平台远程收回，界面必须提前说明。

### 14.4 外部删除账本 `deletion_ledger`

`deletion_ledger` 是主数据库之外的追加式文件或独立轻量存储，不随普通 SQLite 快照回滚，用于恢复后重放删除事实。字段结构：

```text
ledger_seq INTEGER PRIMARY KEY
delete_task_id TEXT NOT NULL
scope TEXT NOT NULL CHECK (scope IN ('quick_session','formal_project','training_attempt','user_account','expired_data','temp_export'))
target_hmac TEXT NOT NULL
accepted_at TEXT NOT NULL
status TEXT NOT NULL CHECK (status IN ('accepted','completed','failed','cancelled'))
db_snapshot_watermark TEXT NULL
entry_hash TEXT NOT NULL
prev_entry_hash TEXT NULL
written_at TEXT NOT NULL
```

写入规则：

- `target_hmac = HMAC(server_ledger_key, scope || ':' || target_id)`，账本不得保存目标明文 ID 以外的业务正文；
- `entry_hash` 覆盖本条除自身外的所有字段和 `prev_entry_hash`，形成可校验链；
- 删除请求受理事务提交前必须先追加 `accepted` 账本项并 fsync；删除任务最终完成、失败或取消时追加对应后续项；
- 恢复流程读取最新账本，按 `ledger_seq` 重放快照之后的删除事实，并校验哈希链连续性；哈希链断裂视为 P0 恢复阻断。

## 15. 迁移和 PostgreSQL 演化

### 15.1 `schema_migrations`

```text
version TEXT PRIMARY KEY
checksum TEXT NOT NULL
description TEXT NOT NULL
applied_at TEXT NOT NULL
applied_by TEXT NOT NULL DEFAULT 'system'
execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0)
```

- `version` 使用单调递增迁移编号；生产启动只允许向前迁移；
- `checksum` 必须与迁移文件内容一致，已应用迁移的校验和不允许变化；
- 迁移前自动备份，迁移脚本可在生产数据副本演练；失败时恢复备份，不做手工半迁移；
- 破坏性变更采用 expand/migrate/contract：先加兼容列或表，回填并验证，再在后续版本移除旧读写；
- JSON Schema、Prompt、模板和静态领域配置版本变化不等于数据库迁移，但必须保留兼容矩阵；
- PostgreSQL 触发条件出现时保持业务 ID、版本号、哈希和枚举语义，替换 Repository 和迁移工具，不改变 PRD/API 行为。

## 16. PRD 需求追踪

本表对齐 PRD §15 与 ADD §23.5 的 32 个可追踪产品需求 ID，标注每个 ID 在本数据库设计中的主要表与约束。追踪链遵循 `00-index.md §4`：PRD ID → ADD 模块/不变量 → API 命令 → 数据库实体 → FSD 页面 → 验收用例。本表只覆盖 PRD → 数据库这一层。

| PRD ID | 主要表/约束 |
|---|---|
| PRD-POS-001 | 快速问诊为默认主路径：`quick_sessions`、`brief_versions`；正式 `projects` 仅在用户选择正式项目或升级时创建 |
| PRD-MODE-001 | `quick_sessions`、正式 `projects`、`training_attempts` 三套独立聚合与状态机，状态不得互相冒充 |
| PRD-ENTRY-001 | 起始页不计入业务阶段；演示链路不入库；真实 HTTP 链路创建 `quick_sessions`/`projects`/`project_intakes` |
| PRD-INTAKE-001 | `projects`、`project_intakes`、只追加修订、`content_hash`、`supersedes_intake_id` |
| PRD-QUICK-001 | `quick_sessions` 状态机（draft→clarifying→understanding_review→option_review→brief_ready→upgraded/archived） |
| PRD-QUICK-002 | `brief_versions.snapshot_json`、`brief_exports`（simple/exec 从同一简报投影） |
| PRD-COVERAGE-001 | `quick_sessions.coverage_slots_json`（六类覆盖槽位状态）；按覆盖推进不按固定轮数 |
| PRD-UNKNOWN-001 | `brief_versions.blocking_unknown_count`、`brief_versions.is_incomplete`；阻断未知只能生成未完成草稿 |
| PRD-TOPIC-001 | 主题变化不静默合并；`quick_sessions` 不污染当前简报，产生新版本 |
| PRD-STATE-001 | 三模式独立状态机：`quick_sessions.status`、`projects.status`、`training_attempts.status` 不得互相映射 |
| PRD-UPGRADE-001 | `project_intakes.source_quick_session_id`/`source_brief_version_id` 只读来源；不复制确认状态/基线 |
| PRD-UPGRADE-002 | `upgrade_records`（UNIQUE(quick_session_id, idempotency_key)）；升级单事务原子、失败回滚（§11 第 7 项） |
| PRD-CASE-001 | 演示 Fixture 文件契约不进入生产数据库；`quick_sessions.source_kind`/`source_case_id` |
| PRD-FLOW-001 | `projects.status`、关口/基线/报告/变化事务（§11 单事务命令 1–6） |
| PRD-GATE-001 | `project_members`、`review_actions`、`tasks`（逾期/无人负责不得自动通过）；AI 不得代办 |
| PRD-EPI-001 | 描述性实体认识类型、`requirements.provenance`、Driver/Decision 链、`evidence_links`、发布前完整性校验 |
| PRD-SCOPE-001 | `requirements.horizon`、`scope_disposition`、`lifecycle_status` 独立；As-Is 由现状实体承载 |
| PRD-REPORT-001 | `baselines`、`baseline_items`、`requirement_versions`、`report_snapshots`、`report_gate_results` |
| PRD-CHANGE-001 | `change_previews` 与 `changes` 分离、`change_impacts`；预演不进正式实体 |
| PRD-TRAIN-001 | `training_cases`、`training_attempts`、`training_questions`、`training_summaries`、`training_feedback`；训练数据与真实项目隔离 |
| PRD-IDENTITY-001 | `guest_sessions.session_key_digest`、`quick_sessions` 当前所有者 XOR 与 `origin_guest_session_id`；只认领指定会话并保留原 ID |
| PRD-AGREEMENT-001 | `agreement_versions`、`agreement_consents`；首次/重大更新需主动同意；撤回阻止新调用并取消未发送任务 |
| PRD-RETENTION-001 | `delete_tasks`、§14.2 九类分层保留策略、§14.3 备份 35 天滚动与恢复重放删除 |
| PRD-NFR-001 | 性能/可用性目标由应用层测量；数据库侧保证索引（§13）、WAL、`busy_timeout`、备份每日 |
| PRD-RISK-001 | `review_actions`、`tasks.assignee_id`（缺专业责任角色时不能接受风险/发布专业结论） |
| PRD-PREFERENCE-001 | `option_preferences`（记录"用户当前偏好"，非正式 Decision）；`matches_ai_recommendation` |
| PRD-SHARE-001 | `brief_exports`（仅 copy/download 指定版本）；不创建公开访问面/公开链接 |
| PRD-TASK-001 | `tasks`（pending/in_progress/completed/overdue/rejected/reassigned）；逾期不自动通过；AI 不得代办 |
| PRD-AUTH-001 | `users`、`project_members`、所有确认身份外键；越权写入安全审计 |
| PRD-USABILITY-001 | 数据库不强制 UI 复杂度；`quick_sessions.coverage_slots_json` 支持渐进披露 |
| PRD-ACTION-001 | §11 单事务命令（前置/成功/失败契约）；`idempotency_records`、`upgrade_records` 幂等 |
| PRD-ANALYTICS-001 | `product_events`（event_id 去重、禁止字段、90 天保留）；业务审计日志与产品事件分开存储 |

追踪表维护规则：

- 新增 PRD ID 时，必须在同一变更中补充本表对应行；
- ID 退役或合并时，保留行但标注"Deprecated"并指向替代 ID；
- 本表只标注主要表与约束，详细字段、约束和索引由各章节维护；
- 云端 AI 调用的协议同意双检查与输入最小化由 §5.3 维护；协议数据本身由 `PRD-AGREEMENT-001` 追踪。
