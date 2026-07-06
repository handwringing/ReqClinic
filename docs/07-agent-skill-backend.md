# ReqClinic 后端 Agent + Skill 架构说明

> 文档状态：Backend AI Runtime Draft v0.7
> 更新日期：2026-07-06
> 适用范围：真实后端 AI 运行时、Skill 编排、审计、快速问诊、正式项目首期和表达训练首期落地。

## 1. 核心结论

ReqClinic 后端采用“单 Orchestrator Agent + 多个版本化 Skill + 明确状态机 + 强 Schema Gate”的受控运行时。

这不是自治多 Agent，也不是让模型自由规划工具链。每个 AI Job 只启动一个 Orchestrator Run，Orchestrator 根据 `mode + state + task_type + domain_profile` 选择固定 AgentPlan，并只能调用 SkillRegistry 中已注册、已版本化、已声明权限的 Skill。

外部 API 不新增 Agent 端点。快速问诊、正式项目和表达训练仍通过原有 API 创建任务；AI 写命令仍返回 `202 + job_id`；前端仍轮询 `/api/v1/ai-jobs/:id`。`task_type` 保留为 API 和队列契约，服务端内部映射到 `agent_plan_id + plan_version`。

## 2. 为什么不是自治多 Agent

现有架构文档的 ADR-009 明确不采用自治多 Agent，理由是要保证可测试、可停止、可追踪。Agent + Skill 方案不改变这个约束：

1. Orchestrator 不能临时发明数据库结构、状态机或专业包。
2. Orchestrator 不能自行激活 DomainPack，也不能把 AI 输出写成 Accepted。
3. Skill 不能绕过协议同意、权限、幂等、预算、Schema Gate 和人工关口。
4. 每次执行必须落到 AgentRun、SkillRun 和 AiRun 审计链。
5. 循环、预算、状态转换和允许写入范围由 AgentPlan 与 Skill Manifest 冻结。

因此本方案对应 ADD 中“将固定任务节点封装为有权限边界的 Worker”的演进，不是自由对话型多智能体系统。

## 3. 运行时对象

| 对象 | 职责 | 不允许 |
|---|---|---|
| Orchestrator Agent | 根据任务上下文选择 AgentPlan，按顺序调用 Skill，汇总结果和状态转换建议 | 自由规划、越权写库、跳过状态机 |
| AgentPlan | 版本化步骤图，定义 Skill 顺序、输入输出连接、停止条件和预算 | 运行时由模型改写 |
| SkillRegistry | 注册可调用 Skill，按 `skill_id + skill_version` 查找 Manifest 和 runner | 接受未注册 Skill |
| Skill | 执行一个需求分析能力，产出结构化结果 | 直接创建正式批准、正式基线或未审专业包 |
| DomainPack | 提供领域问题集、术语映射、校验器、报告扩展和评测用例 | 改写核心实体语义 |
| Schema Gate | 校验 Skill/模型输出结构、引用和业务规则 | 用模型自报置信度替代校验 |

## 4. Skill 分类

Skill 顶层分类固定为六类：

| 分类 | 作用 | 快速问诊首期输出 |
|---|---|---|
| `routing` | 判断模式、领域、风险、应加载的专业包候选 | `general` 回退或领域包候选、风险标记 |
| `elicitation` | 生成下一轮 AI 追问 | 下一条具体问题、对应覆盖槽位 |
| `structuring` | 沉淀结构化理解 | 槽位 patch、未知项、卡片绑定解释 |
| `validation` | 检查缺口、冲突、风险、覆盖状态和需求质量 | 继续追问、进入理解确认、需求质量问题 |
| `decisioning` | 形成候选方案、范围、边界和偏好 | 方案比较、推荐和用户当前偏好 |
| `composition` | 生成简报和报告视图 | 同一 brief snapshot 的概述、详细报告两类投影 |

Skill Manifest 必须包含：

```yaml
skill_id: quick.elicitation.next_question
skill_version: 1.0.0
category: elicitation
supported_modes: [quick]
input_schema_version: quick_elicitation_input.v1
output_schema_version: quick_elicitation_output.v1
prompt_version: qe-prompt-v1
allowed_state_transitions:
  - clarifying -> clarifying
  - clarifying -> understanding_review
allowed_writes:
  - quick_turns
  - quick_sessions.coverage_slots_json
required_domain_packs:
  - general
validators:
  - schema
  - coverage_slot_known
  - no_formal_decision
```

## 5. DomainPack 规则

DomainPack 是 Skill 可读取的领域约束来源，不等于 Skill 本身。

1. DomainPack 提供领域问题集、术语映射、校验器、报告章节和评测用例。
2. Skill 可以读取已激活或候选 DomainPack，但不能临时发明正式 Schema。
3. AI 只能提出 Candidate DomainProfile 或专业包建议。
4. 专业包激活必须经过注册表候选、兼容性、组合冲突和风险校验。
5. 正式项目的混合领域、高风险或未知路由风险仍需要人工确认。
6. 未命中专业包时必须回退 `general`，不得伪装成完成专业审查。

## 6. Spec Kit 借鉴边界

Spec Kit 的价值不在于把命令式开发流程搬进 ReqClinic，而在于把需求说明当成可以检查、澄清、复核的一等工件。ReqClinic 首期借鉴以下五点，但转换为普通用户可接受的产品语言：

| 借鉴点 | ReqClinic 落地方式 | 用户可见方式 |
|---|---|---|
| 需求质量检查 | validation skill 检查完整性、清晰度、一致性、可验证性、范围边界、未知项 | 不展示开发者味 checklist，只在需要时提示“还没完全确定的事” |
| 澄清问题优先级 | validation 先按“影响 × 不确定性”排序，elicitation 只问最高价值问题 | AI 每次只问一个具体问题 |
| 不确定性标记 | 内部保留 missing / partial / inferred / confirmed | 转成“尚未提供、待确认、系统推测、影响较大，建议先确认” |
| 跨工件一致性 | composition 只能从同一 brief snapshot 投影概述和详细报告 | 报告不得凭空出现对话、卡片、当前理解中没有的事实 |
| 原则约束 | 运行时内置需求分析原则 | 不伪造确定性、不替用户做正式决策、不隐藏重大未知、快速问诊不等于正式基线 |

详细报告可以借鉴 Spec Kit 的规格文档结构，例如用户场景、功能需求编号、成功标准、边界情况、假设依赖和澄清记录；概述必须使用普通用户能直接理解的表达。

当前实现已经把报告质量检查落到三条链路：

1. 快速问诊：模型报告若编造未确认能力，回退到确定性报告；未完成草稿保留缺失项。
2. 正式项目：报告从 `formal_map_snapshot` 投影，项目起点信息集中展示一次，用户回答按追问语义归入对应地图节点，候选方案渲染为表格。
3. 表达训练：反馈从训练回合生成，只指出追问覆盖、遗漏和改写建议，不写入项目资产。

浏览器验收与 token 审计记录见 `10-release-readiness-and-design-review.md`。

## 7. 快速问诊首期 AgentPlan

快速问诊真实链路计划 ID 固定为 `quick_consult.v1`。

```text
routing
  -> structuring
  -> validation
  -> elicitation
  -> decisioning
  -> composition
```

这个顺序对应真实问诊逻辑：先从用户输入和回答中提炼当前理解，再做需求质量与缺口判断，然后由 AI 决定下一问。不能先生成问题再补做结构化，否则提问优先级无法基于最新理解。

### 7.1 `routing`

输入：用户第一句话、入口来源、案例或自定义标识、已有 DomainProfile 候选。

输出：模式为 `quick`、领域候选、风险标记、默认 `general` 或领域包候选。

约束：普通快速问诊不创建正式 DomainProfile 审批结果。

### 7.2 `structuring`

输入：用户回答、当前问题、卡片绑定关系。

输出：结构化理解 patch、覆盖槽位更新、未知项更新。

约束：卡片引用只在 AI 认为理解已整理、用户要修改时发生；不能在中途脚本要求绑定未显示卡片。

### 7.3 `validation`

输入：当前理解、覆盖槽位、未知项。

输出：继续追问、进入理解确认、阻断未知清单和需求质量检查结果。

约束：

1. 覆盖不足时继续追问；阻断未知不能静默降级。
2. 下一问优先级按 `priority = impact_weight × uncertainty_weight` 计算。
3. 需求质量检查是内部能力，不做成面向用户的开发者 checklist 页面。
4. 跨工件一致性必须在 composition 前检查，防止报告新增未来源化事实。

### 7.4 `elicitation`

输入：当前理解、覆盖槽位、未知项、validation 排序后的最高价值缺口。

输出：下一条具体 AI 追问。

约束：AI 决定问什么；用户只回答当前问题；不能要求用户自己列清需求；一次只问一个重点。

### 7.5 `decisioning`

输入：已确认的当前理解、范围边界、风险和用户偏好。

输出：候选方案、推荐方案、取舍说明、用户当前偏好。

约束：快速问诊不产生正式 Decision，不生成正式项目基线。

### 7.6 `composition`

输入：同一份 brief snapshot。

输出：概述、详细报告。详细报告同时作为导出正文来源。

约束：两个视图来自同一版本，不单独生成新事实、需求或决策；详细报告必须覆盖完整需求分析文档结构，不能退化为摘要或简略清单。

## 8. 详细指导报告的泛化生成

ReqClinic 不把所有领域模板一次性写死。后端固定“需求分析内核”，再让 AI 在约束内生成领域化模块计划。

固定内核：

1. 目标：要达成什么。
2. 对象：给谁用、给谁看、谁参与、谁受影响。
3. 场景：在什么情况下发生。
4. 交付物：最终要拿到什么。
5. 范围：这次包含什么、不包含什么。
6. 标准：怎样判断完成或成功。
7. 约束：时间、预算、资源、合规、风险。
8. 未确认项：哪些不能被 AI 写成确定事实。

该能力不直接挂在快速问诊页。用户必须先查看快速报告，再点击“升级正式项目”。升级后，后端以 quick brief snapshot 作为正式项目候选来源，启动新的异步 Job。该 Job 仍由同一个 Orchestrator 调度，但使用 `formal_guidance_report.v1` AgentPlan。首页直接创建正式项目时也使用同一个 plan，只是来源从 quick snapshot 变为建档表单和项目 intake。

```text
snapshot_freeze
  -> domain_framing
  -> module_planning
  -> module_elicitation
  -> module_optioning
  -> guidance_composition
  -> consistency_review
```

### 8.1 `snapshot_freeze`

冻结当前 quick brief snapshot，记录输入哈希、brief 版本、用户已确认内容和待确认项。冻结结果只作为正式项目候选来源，不能自动变成正式基线。后续报告只能从这个 snapshot、正式项目新增材料和用户新增回答生成事实。

实现约束：

1. 快速简报中的期望结果、目标用户、核心场景、范围、完成标准、风险、未知项和候选方案必须带入正式项目地图。
2. 这些内容在正式地图中应显示为“快速问诊候选”或等价的自然语言提示，落在对应模块的“初步判断 / 待确认”区域，而不是写入正式已确认事实。
3. 模型输出不得覆盖或丢弃 quick brief snapshot 中已有的候选内容；如果模型返回的模块缺失这些候选，运行时必须用确定性合并逻辑补回。
4. 用户在正式项目中回答后，新的回答可以把候选内容推进为更明确的地图内容，但仍不得自动写入正式基线。

### 8.2 `domain_framing`

判断当前项目更接近哪类工作，例如软件构建、活动策划、学术写作、外包采购、服务流程、多人协作或早期想法。

约束：

1. 输出只能是候选领域，不创建正式 DomainProfile。
2. 未命中高置信领域时使用 `general`。
3. 领域判断必须说明依据，不能只给标签。

### 8.3 `module_planning`

根据固定内核和候选领域生成模块计划。模块计划不是最终报告，而是正式项目“需求地图工作台”的数据来源。

建议 schema：

```json
{
  "report_plan_id": "guidance_plan_001",
  "domain": "activity_planning",
  "modules": [
    {
      "module_id": "audience",
      "title": "目标人群与参与动机",
      "purpose": "说明活动要影响谁，以及他们为什么会参与。",
      "status": "needs_choice",
      "known_facts": [],
      "assumptions": [],
      "open_questions": [],
      "candidate_options": []
    }
  ],
  "estimated_duration_seconds": {
    "min": 60,
    "max": 180
  }
}
```

用户界面展示时必须转成自然语言状态：已明确、正在梳理、有方案可选、待确认、建议复核。

模块计划必须是可扩展结构：

1. `modules` 数量由主题、材料、风险和用户目标决定，不能固定为某个 demo 数量。
2. 每个模块必须至少包含 `module_id`、`title`、`purpose/summary`、`status`、`known_facts`、`assumptions`、`open_questions`、`candidate_options` 和 `related_module_ids` 的等价字段。
3. Skill 可以生成章节组、父子节点或关联关系，但不能临时发明不受 Schema Gate 管理的新字段。
4. 前端应按同一结构渲染 3-12 个模块；更多模块应允许分组、折叠、搜索或内部滚动，而不是改变业务状态机。
5. 快速问诊仍使用轻量卡片投影，不直接消费正式项目地图；表达训练仍使用训练问题集和反馈面板，不消费正式项目地图。

### 8.4 `module_elicitation`

按模块追问，不让用户自己想完整大纲。每次只问当前模块中价值最高的问题。

约束：

1. 一个问题只解决一个主要不确定点。
2. 如果模块存在多种合理路径，应先进入 `module_optioning`，给用户选择方案。
3. 用户可主动点选右侧模块、问题或方案，把它作为引用加入对话框。

### 8.5 `module_optioning`

为复杂模块生成候选方案，例如活动策划中的低成本传播型、现场转化型、品牌背书型；软件项目中的模板优先、智能生成优先、混合方案。

约束：

1. 每套方案必须说明适用条件、收益、代价、风险和可调整性。
2. 推荐方案必须说明理由。
3. 用户选择只是当前偏好，不是正式决策。

### 8.6 `guidance_composition`

生成详细指导报告。报告结构由模块计划决定，不能用同一套软件规格模板套所有项目。

例如活动策划案可包含：活动目标、目标人群、活动形式、主流程、时间地点、资源配置、宣发计划、风险预案、成功指标、执行节奏和复盘方式。

例如软件项目可包含：用户故事、功能需求、关键对象、边界情况、验收场景、非功能约束和后续任务。

### 8.7 `consistency_review`

报告生成后必须检查：

1. 详细报告是否只使用同一 snapshot 与新增回答中的事实。
2. 正式项目地图、模块计划、概述和详细报告是否一致。
3. 未确认内容是否仍标为待确认或系统推测。
4. AI 是否把快速问诊草稿写成正式承诺。

### 8.8 等待进度

前端进度页轮询原有 AI Job。后端返回 Job status 与当前阶段，不新增前端可见 Agent API。

推荐阶段文案：

1. 整理已确认内容。
2. 判断项目类型。
3. 生成模块计划。
4. 撰写章节内容。
5. 检查前后一致性。
6. 准备结果。

预计时间只返回区间，不返回精确倒计时。本地模型、网络模型、报告长度和补充问题数量都会影响耗时。

## 9. 当前实现落点

当前后端已按以下边界实现快速问诊和正式项目首期真实链路：

1. `src/agent/quick-runtime.ts` 提供本地可运行的快速问诊 Skill Runtime。
2. `src/agent/quick-schemas.ts` 定义 Skill 输出 schema gate。
3. `src/agent/formal-runtime.ts` 提供正式项目需求地图 Runtime；输出 `formal_map_snapshot`，同时保留确定性 fallback。
4. `src/agent/formal-schemas.ts` 定义正式项目地图快照 schema gate，约束模块数量、状态、候选方案、待确认项和报告投影。
5. `src/ai/ollama-provider.ts` 和 OpenAI-compatible provider 支持本地 Ollama 或胜算云 DeepSeek 等兼容接口；`AI_PROVIDER=stub` 为默认值，保证单测确定性。
6. `src/queue/quick-job-executor.ts` 将 quick session 的 `202 + job_id` 接入 Skill Runtime，并写回会话状态、覆盖槽位、当前理解、未知项、候选方案和简报版本。
7. `src/queue/formal-job-executor.ts` 将 `scope_kind=formal_project + task_type=formal_guidance` 接入正式项目 Runtime，持久化地图快照并追加下一条 AI 追问。
8. `src/queue/worker.ts` 对 `scope_kind=quick_session` 使用 quick executor，对 `formal_guidance` 使用 formal executor，对 `scope_kind=training_attempt` 使用 TrainingJobExecutor。
9. `src/db/schema/formal.ts` 与迁移 `0003_formal_map_snapshots.sql` 增加 `formal_map_snapshots` 和 `formal_turns`，用于版本化地图和对话记录。
10. `GET /projects/{id}/formal-map` 返回当前地图快照、对话记录和活跃 job；`POST /projects/{id}/formal-messages` 提交回答或地图节点引用，并触发新的 formal job。
11. `POST /projects` 会创建项目、初始 intake 和 `formal_guidance` job；快速简报升级会冻结 quick brief snapshot，创建正式项目并启动同一个正式 plan。
12. `formal-runtime.ts` 会把 quick brief snapshot 的目标、对象、场景、范围、完成标准、风险和候选方案合入正式地图相应节点，显示为待确认候选，避免模型生成时丢失升级来源。
13. 本地开发和 demo 环境支持 guest formal owner bridge：前端仍自动建立 guest 和协议同意，后端把 guest 映射为受控本地正式项目 owner；生产账号体系可继续收紧。
14. `src/app.ts` 注册真实 v1 路由、身份、协议门禁和幂等；`src/server.ts` 启动 JobWorker。
15. `ReqClinic/lib/api/http-transport.ts` 允许前端通过环境变量切到真实后端；案例演示仍可保留固定数据，但真实链路使用 HTTP API。
16. `npm run audit:ai` 可在后端目录导出只读 AI 审计摘要，用于检查 job、skill、provider、model、thinking 和 token 记录。
17. 表达训练当前具备 `training_cases / training_attempts / training_questions / training_summaries / training_feedback / training_turns`、训练路由、前端训练页、DeepSeek 角色回答、真实教练反馈和训练回合恢复。训练真实链路的浏览器验收与后续演进见 `08-expression-training-development-plan.md`。

前端接入策略是“双轨”：教学 demo 继续使用 fixtures 和 MockTransport；正式产品开发可设置 `NEXT_PUBLIC_API_TRANSPORT=http` 和 `NEXT_PUBLIC_API_BASE_URL` 切到真实后端。真实后端不新增 Agent API，仍保持现有 `202 + job_id` 外部契约。

快速问诊卡片绑定的后端载荷为 `bound_refs` 或等价结构化输入。当前前端 demo 仍以输入框 token 展示绑定对象；正式链路必须把绑定对象作为 structuring skill 的输入来源之一，不能把卡片全文拼成不可追踪的普通文本。

## 10. 正式项目与表达训练边界

正式项目复用同一 Orchestrator，但 AgentPlan 必须受正式项目状态机和人工关口约束。AI 只能创建 Candidate/Supported，不得调用确认、批准、发布或基线接受类动作。

正式项目的前端主界面是“左侧对话 + 需求地图工作台”。旧七段式流程只能作为后台状态、门禁和审计约束存在，不能再作为用户主导航。正式项目 AgentPlan 的主要输出是可版本化的 `map_snapshot`：

1. `map_snapshot.core`：项目核心、来源、当前目标和重要约束。
2. `map_snapshot.modules[]`：不同主题生成的模块节点，数量可变。
3. `map_snapshot.active_module_id`：当前 AI 正在追问的节点。
4. `map_snapshot.edges[]` 或 `related_module_ids`：节点间影响关系。
5. `map_snapshot.report_projection`：概述、详细报告和导出内容的同源快照。
6. `map_snapshot.unresolved_items`：待确认、系统推测和影响较大的未定内容。

正式项目页面必须能在不改前端组件结构的前提下展示软件、活动策划、学术写作、外包采购、服务流程、多人协作等不同模块集合。节点过多时由 UI 做内部滚动、分组或折叠；状态推进仍由后端状态机和 Schema Gate 决定。

当前正式项目首期已经落地 `formal_guidance_report.v1`，用于生成专业指导报告和需求地图工作台。它不替代未来完整正式基线流程：后续的确认、证据、冲突、基线、变更和发布仍由正式项目状态机控制。

表达训练不是快速问诊或正式项目的附属流程。当前它已经有基础页面、基础 API、训练数据表和真实 Agent + Skill Runtime。它可以复用同一个受控 Skill Runtime，但主导权相反：用户练习追问，AI 扮演客户、老师、同事或业务方，教练 Skill 在总结后给出反馈。训练 Skill 不得写入快速问诊或正式项目事实。

表达训练计划中的首期 AgentPlan 为 `training_practice.v1`，详见 [08-expression-training-development-plan.md](./08-expression-training-development-plan.md)。该计划至少包括：

1. `training.routing.case_context`：读取训练案例和隐藏规则，但只向前端投影公开信息。
2. `training.roleplay.answer`：按角色回答用户追问，只披露用户问到的信息。
3. `training.structuring.coverage_update`：更新覆盖维度、问题质量和披露规则命中。
4. `training.validation.question_quality`：识别无意义、重复、诱导或过宽的问题。
5. `training.coaching.next_hint`：给出下一步追问建议，但不泄露答案。
6. `training.composition.feedback_report`：用户提交总结后生成维度反馈、遗漏点、改进追问和改进总结。

快速问诊和表达训练的扩展边界：

1. 快速问诊扩展的是模板卡片、优先维度、复核引用和报告投影，不扩展为正式项目地图。
2. 表达训练扩展的是案例、角色回答、建议追问和反馈维度，不扩展为正式项目地图，也不产生真实需求事实；隐藏案例事实、评分量表和完整披露规则必须留在后端。
3. 三种模式可以共享 Skill Runtime、质量检查和领域包，但必须使用各自的前端投影和数据写入范围。

### 10.1 `training_practice.v1` AgentPlan 与 Skill Manifest 设计

表达训练首期 AgentPlan 的正式定义如下（与 §7 快速问诊 AgentPlan、§8 详细指导报告 AgentPlan 同级，受同一 Orchestrator 与 Skill Runtime 约束）：

```yaml
planId: 'training_practice'
planVersion: '1.0.0'
agentId: ORCHESTRATOR_AGENT_ID
mode: 'training'
taskTypes: ['training_response', 'training_feedback']
steps:
  - { skillId: 'training.routing.case_context', skillVersion: '1.0.0' }
  - { skillId: 'training.roleplay.answer', skillVersion: '1.0.0' }
  - { skillId: 'training.structuring.coverage_update', skillVersion: '1.0.0' }
  - { skillId: 'training.validation.question_quality', skillVersion: '1.0.0' }
  - { skillId: 'training.coaching.next_hint', skillVersion: '1.0.0' }
  - { skillId: 'training.composition.feedback_report', skillVersion: '1.0.0' }
```

`mode: 'training'` 与快速问诊（`quick`）和正式项目（`formal`）隔离；`taskTypes` 只允许 `training_response`（提交追问后的角色回答）和 `training_feedback`（提交总结后的反馈报告），不得承载快速问诊或正式项目任务类型。

#### 6 个训练 Skill 设计

| Skill | 调用模型 | 作用 | 输出是否给用户看 |
|-------|---------|------|----------------|
| `training.routing.case_context` | 否 | 读取案例、难度、角色、目标维度 | 否 |
| `training.roleplay.answer` | 是 | 扮演客户/老师/同事/业务方回答用户追问 | 是 |
| `training.structuring.coverage_update` | 可选 | 判断用户追问命中的维度和披露规则 | 否 |
| `training.validation.question_quality` | 可选 | 判断问题是否有效、是否太空泛、是否重复 | 部分展示 |
| `training.coaching.next_hint` | 是或确定性 | 给下一步练习提示，不泄露答案 | 是 |
| `training.composition.feedback_report` | 是 | 用户总结后生成完整反馈 | 是 |

调用模型为「否」的 Skill（如 `training.routing.case_context`）只做确定性路由与上下文装载，不调用 DeepSeek，避免在路由阶段引入模型不确定性。调用模型为「是」或「可选」的 Skill 必须经过 SkillRun / AiRun 审计，并接受 Schema Gate 校验。输出标注「否」的 Skill 结果只用于后端状态推进，不直接回传浏览器；标注「部分展示」的 Skill 只把可解释的质量提示回传，不暴露内部判定阈值。

#### Skill Manifest 接口

训练 Skill Manifest 在通用 Skill Manifest 基础上增加训练专属字段，用于约束状态转换与写权限。接口定义如下：

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

`supported_modes` 固定为 `['training']`，确保训练 Skill 不会被快速问诊或正式项目 AgentPlan 误调用。`allowed_state_transitions` 与 `allowed_writes` 必须显式声明，未声明的状态转换与写入一律由 Schema Gate 拒绝。`required_domain_packs` 至少包含训练案例领域包；`validators` 至少包含确定性覆盖检查，确保 AI 反馈失败时仍能展示基础覆盖结果。

#### 训练 Skill 写权限白名单

训练 Skill 的数据写入范围必须显式声明，并受 Skill Runtime 强制校验。允许与禁止的写入如下：

1. 可以写 `training_questions.disclosure_rule_hit`：记录用户追问命中的披露规则，用于覆盖判定。
2. 可以写训练角色回答快照表：保存 `training.roleplay.answer` 的输出快照，供审计与回放。
3. 可以写 `training_feedback`：由 `training.composition.feedback_report` 在用户提交总结后写入完整反馈。
4. 不得写 `quick_sessions`：训练 Skill 不得污染快速问诊会话状态。
5. 不得写 `projects`、`requirements`、`baselines`、`formal_map_snapshots`：训练结果不得沉淀为正式项目事实、需求、基线或正式地图快照。

违反白名单的写入由 Schema Gate 与数据访问层双重拦截，并记入 SkillRun 审计的错误码字段。

## 11. 审计模型

AI Job 是外部轮询和任务生命周期单位；AgentRun 和 SkillRun 是后端可审计执行单位。

```text
ai_jobs
  └─ agent_runs
       └─ skill_runs
            └─ ai_runs (0..n)
```

建议表：

```text
agent_runs(
  id, ai_job_id, agent_id, plan_id, plan_version, mode,
  status, input_hash, output_hash, started_at, completed_at
)

skill_runs(
  id, agent_run_id, step_index, skill_id, skill_version,
  category, status, input_hash, output_hash,
  input_schema_version, output_schema_version,
  prompt_version, provider, model, thinking_mode,
  input_tokens, output_tokens, error_code, started_at, completed_at
)
```

默认不保存完整业务正文。输入和输出正文仍按现有敏感信息、审计 blob、保留期和删除任务规则处理。

内部可观测性不新增公开 Agent API。当前后端提供只读脚本 `npm run audit:ai -- --mode quick|formal|training --limit 50`，用于从本地 SQLite 汇总 job、mode、skill、provider、model、thinking mode、input/output token、估算标记、错误码和回退线索。该脚本只用于开发验收和排查，不向普通用户界面暴露，也不得输出 API key 或业务正文。

## 12. Schema Gate 与状态机

每个 Skill 至少有一层结构化输出 Schema。模型输出先进入 Skill 级 Schema Gate，再进入任务级业务门禁。

状态推进原则：

1. Skill 只能建议 Manifest 中声明的状态转换。
2. Orchestrator 汇总结果后由应用服务执行状态转换。
3. AI 不能直接调用正式确认端点。
4. 状态转换失败时 Job 失败或进入人工处理，不允许模型自行修复数据库。
5. 相同输入、Skill 版本、Prompt 版本、DomainPack 版本和模型配置可哈希复用。

## 13. 本地模型运行方式

本地模型只作为开发验证后端流程的 provider，不改变外部 API。当前真实验收可以使用胜算云 DeepSeek，也可以在本地用 Ollama 验证流程可达性：

```bash
cd backend
set AI_PROVIDER=ollama
set OLLAMA_BASE_URL=http://localhost:11434
set OLLAMA_MODEL=qwen3.5:9b
npm run dev
```

PowerShell 可使用：

```powershell
$env:AI_PROVIDER="ollama"
$env:OLLAMA_MODEL="qwen3.5:9b"
npm run dev
```

前端真实后端模式：

```powershell
cd ReqClinic
$env:NEXT_PUBLIC_API_TRANSPORT="http"
$env:NEXT_PUBLIC_API_BASE_URL="http://localhost:4000/api/v1"
npm run dev
```

实现要求：

1. Ollama provider 只负责模型调用和 JSON 解析。
2. Skill Runtime 必须保留确定性兜底，模型格式错误不得污染状态。
3. 真实写库前必须经过 Skill schema gate 和任务级业务门禁。
4. 本地模型不可用时，后端测试仍使用 stub provider。

## 14. API 兼容性

首期不新增前端可见 Agent API。

| 现有契约 | 保持方式 |
|---|---|
| AI 写命令返回 `202 + job_id` | 不变 |
| 前端轮询 `/api/v1/ai-jobs/:id` | 不变 |
| `task_type` | 队列层保留，内部映射到 AgentPlan |
| OpenAPI operationId | 增加正式地图读写端点，其余 Agent 外部契约不新增 |
| MockTransport | 可用固定 AgentRun/SkillRun 脚本模拟 |

## 15. 测试策略

首期验收测试必须覆盖：

1. AgentPlan registry：每个 `mode + task_type + state` 映射到唯一 plan。
2. Skill manifest：所有 Skill 的分类、模式、schema 版本、prompt 版本和写权限完整。
3. Skill schema：输入输出通过 Zod 或 JSON Schema 校验。
4. 快速问诊黄金路径：第一句话 → AI 追问 → 用户回答 → 结构化理解 → 复核 → 方案 → 简报。
5. 缺口路径：覆盖不足时继续追问，不能直接生成完整简报。
6. 卡片修改路径：复核前不能要求绑定卡片；复核后卡片绑定进入 structuring。
7. 专业包回退：未知领域回退 `general`，不能临时发明专业字段。
8. 审计链：每个 Job 可追踪到 AgentRun、SkillRun、AiRun、prompt/schema/domain pack 版本。
9. 安全：协议未同意、权限不足、撤回同意后不得创建新模型调用。
10. 需求质量检查：完整性、清晰度、一致性、可验证性、范围边界、未知项均有内部检查输出。
11. 跨工件一致性：对话、右侧卡片、当前理解、概述、详细报告不得互相矛盾。
12. 案例一致性：至少选一个前端演示案例跑完整 Runtime，确认关键事实被保留，同时没有把案例报告中未由问答确认的细节写成确定事实。
13. 正式项目黄金路径：首页建档 → formal job → 地图快照 → AI 追问 → 用户回答 → 新地图快照 → 报告投影。
14. 升级路径：快速简报升级后只迁移候选来源，不把 quick 确认写成正式基线；目标用户、范围、完成标准等候选必须在正式地图对应节点可见。
15. 地图扩展：软件、活动策划、学术写作、外包采购、服务流程、多人协作等主题必须生成差异化模块。
16. 审计统计：formal job 可以追踪到 AgentRun、7 个 SkillRun、AiRun、provider/model/thinking/token 字段。
17. 表达训练计划测试：`training_response` 必须只披露用户问到的信息，无意义输入不得触发隐藏事实披露。
18. 表达训练反馈测试：`training_feedback` 必须指出覆盖维度、遗漏点、改进追问和总结问题，且不把训练结果写入 quick/formal 表。
19. 表达训练安全测试：浏览器不得拿到 `answer_key`、完整 `disclosure_rules`、隐藏事实或评分触发规则。
20. 表达训练审计测试：每个训练追问和训练反馈 Job 必须可追踪到 AgentRun、SkillRun、AiRun、provider/model/thinking/token 字段。

## 16. 与现有文档一致性

| 文档 | 当前一致性 | 后续同步 |
|---|---|---|
| `02-architecture.md` | 已有 AI Job、Schema Gate、DomainProfile、专业包和非自治多 Agent 约束 | 补充单 Orchestrator + Skill Runtime 作为固定 Worker 的首选实现 |
| `03-api-design.md` | `202 + job_id` 和轮询契约可直接承载 Orchestrator Run；已补充 formal map 读写端点 | 继续同步 guest/local demo 与生产身份策略的差异 |
| `04-database-design.md` | 已有 `ai_jobs / ai_runs / domain_profiles / domain_packs`；实现已补 `formal_map_snapshots / formal_turns` | 补充正式地图快照物理表章节 |
| `06-interaction-flow.md` | AI 主导追问、卡片绑定、正式项目地图和表达训练真实链路方向一致；已区分快速真实链路、案例演示和训练练习边界 | 继续用浏览器验收校正文案和页面状态 |
| `08-expression-training-development-plan.md` | 已补充并落地表达训练真实 Runtime、API 调用、隐藏案例信息、DeepSeek 接入和浏览器验收方案 | 后续训练链路精修时同步 03/04/05/06 与 OpenAPI |

## 17. 结论

ReqClinic 的后端 AI 不应建成自由多智能体系统，而应建成可审计的需求分析运行时。Orchestrator 负责流程，Skill 负责可版本化能力，DomainPack 负责领域约束，状态机和 Schema Gate 负责边界。这样既符合当前文档的安全与审计不变量，也能支持后续逐步扩展到正式项目和表达训练。
