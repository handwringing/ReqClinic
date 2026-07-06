# 需求问诊室 · 文档索引与维护规则

> 文档状态：治理基线 v2.1
> 更新日期：2026-07-07

## 1. 文档地图

| 文档 | 唯一维护内容 | 当前状态 |
|---|---|---|
| [01-PRD.md](./01-PRD.md) | 产品定位、目标用户、三种模式、身份与协议、数据生命周期、业务操作矩阵、非功能目标、产品埋点、指标、输出、里程碑和验收 | Product Requirements Baseline v2.3（Frozen）；当前实现已进入快速问诊、正式项目与表达训练真实链路验收阶段 |
| [02-architecture.md](./02-architecture.md) | 架构决策、模块边界、逻辑模型、不变量、状态机、质量、安全和演化触发条件 | Architecture Baseline v1.4；当前实现已落地单 Orchestrator + Skill Runtime 的快速问诊、正式项目首期和表达训练首期链路 |
| [03-api-design.md](./03-api-design.md) | 资源与命令语义、授权、幂等、并发、状态转换、错误、异步协议和 Mock/HTTP 双轨使用规则 | v1.3 实现对齐；快速问诊、正式项目和表达训练均使用真实 HTTP + Job，演示链路保留为回归手段 |
| [03-api-openapi.yaml](./03-api-openapi.yaml) | 可执行 API 线协议：路径、方法、参数、请求/响应 Schema、必填性、可空性和状态码；MockTransport 与 HttpTransport 共用 | OpenAPI 3.1 v1.3.0；训练案例公开详情已移除前端可见答案和完整披露规则 |
| [04-database-design.md](./04-database-design.md) | 物理表、字段、约束、索引、事务、迁移、保留与恢复 | Physical Design Baseline v1.3；当前迁移已覆盖 Agent/Skill 审计、usage 审计、正式地图快照和训练回合恢复 |
| [05-fsd.md](./05-fsd.md) | 页面、组件、交互、响应式、无障碍、实现映射、差异清单和读取契约 | Frontend Spec v2.3 实现对齐；快速问诊、正式项目和表达训练页面均接真实后端，表达训练仍需持续浏览器精修 |
| [06-interaction-flow.md](./06-interaction-flow.md) | 集中式逐屏交互流程、首页分流、模式边界、案例边界、快速问诊/正式项目/训练的用户路径 | Interaction Flow Baseline v0.2；同步当前三模式真实链路与演示链路边界 |
| [07-agent-skill-backend.md](./07-agent-skill-backend.md) | 后端 AI 运行时、单 Orchestrator、Skill Registry、DomainPack 关系、Agent/Skill 审计、快速问诊、正式项目和表达训练 AgentPlan | Backend AI Runtime Draft v0.6；三种模式首期真实链路均按受控 Orchestrator + Skill Runtime 落地 |
| [08-expression-training-development-plan.md](./08-expression-training-development-plan.md) | 表达训练真实链路开发计划、训练 AgentPlan、案例隐藏信息、API 调用、胜算云 DeepSeek 接入、前后端改造和浏览器验收 | Implementation Baseline v0.2；真实训练 Runtime 已接入，当前重点是浏览器体验、恢复和反馈质量验收 |
| [09-product-language-and-design-review.md](./09-product-language-and-design-review.md) | 用户可见品牌、三功能边界、入口文案、状态词映射、报告口径和设计评审清单 | Product Language Baseline v0.1；以“需求问诊室 / Requirements Clinic”为统一用户可见品牌口径 |
| [10-release-readiness-and-design-review.md](./10-release-readiness-and-design-review.md) | 三功能浏览器验收、报告质量、移动端、Agent/Skill 审计、token 统计和设计评审准入结论 | Release Readiness Review v0.1；除 Edge 专项外的六项长线收口已完成一轮联合验收 |
| [11-manual-browser-acceptance.md](./11-manual-browser-acceptance.md) | 可重复人工浏览器验收脚本：首页、三模式、真实链路、示例体验、异常、移动端、token 成本和 P0-P3 判定 | Next Productization Acceptance v0.1；最终体验结论必须来自 Browser 插件真实操作 |
| [12-case-matrix-and-regression.md](./12-case-matrix-and-regression.md) | 三模式案例矩阵、示例闭环、必测交互、不可编造事实、必须保留未知项和回归检查清单 | Regression Matrix v0.1；用于示例体验和真实链路横向比较 |
| [13-pilot-boundary.md](./13-pilot-boundary.md) | 小范围试用阶段的游客身份、模型配置、数据保留、重复提交、长等待和失败恢复边界 | Pilot Boundary v0.1；明确当前不进入完整生产化能力 |

原完整架构书只作为拆分迁移的历史基准。上述拆分文档生效后，新设计不再只写回原文件。

## 2. 冲突处理顺序

同一事项出现冲突时，先应用不可被普通产品需求覆盖的优先级：

```text
适用法律/监管义务
  > 人身安全、信息安全、隐私和数据完整性不变量
  > 已批准架构宪法与审计要求
  > PRD 产品承诺
  > API / 数据库 / FSD 实现细节
```

随后判断内容归属：

1. 产品承诺和验收以 PRD 为准；
2. 跨模块不变量、状态转换和安全边界以 ADD 为准；
3. API 的业务语义、授权、幂等、并发和状态转换以 API 设计为准；
4. 实际线协议的路径、方法、字段、类型、必填性、可空性和 HTTP 状态码以 OpenAPI 为准；
5. 物理存储、约束和迁移以数据库设计为准；
6. 页面呈现和交互细节以 FSD 为准；
7. 用户可见命名、文案口径和设计评审清单以产品语言规范为准。

API 设计与 OpenAPI 不是两套可独立演化的契约。两者发生差异时视为阻断缺陷：先依据上游 PRD/ADD 确认正确语义，再在同一变更中同步修改 Markdown、OpenAPI、契约测试和受影响客户端；不得以“文档优先”或“代码优先”为由长期保留差异。

下游文档不得放宽上游不变量。例如 FSD 不能用按钮文案绕过人工关口，API 不能允许 AI 执行确认，数据库设计不能允许无来源事实进入正式状态。发现冲突时修订内容归属文档，并同步受影响引用，不通过复制同一规则解决。

## 3. 证据等级

关键设计结论使用以下标签，避免把研究原则和具体实现混为一谈：

| 标签 | 含义 | 可用于 |
|---|---|---|
| `[R] Research-supported` | 有同行评审研究、标准或权威知识体系支持的原则 | 解释为何需要目标、证据、协商、验证、变化和人工责任 |
| `[E] Engineering decision` | 基于当前人员、成本和技术约束作出的可逆选择 | Next.js、SQLite、模块化单体、轮询、报告投影方式 |
| `[H] Hypothesis to validate` | 尚无充分证据，必须通过评估证伪或确认 | 七阶段可理解性、三关口成本收益、Flash/Pro 路由、游戏化交互、领域泛化 |
| `[D] Demo-only` | 为纯前端叙事预生成的虚构内容 | Aster 人物、目标、指标、确认记录和模型输出 |

文档中未标标签的普通细节默认属于其所在文档的工程契约，不代表学术上已验证或全领域最优。

## 4. 端到端追踪

实现和测试使用以下追踪链：

```text
PRD 需求 ID
  → ADD 架构不变量/模块
  → API 命令或查询
  → 数据库实体与约束
  → FSD 页面/交互
  → 自动化或人工验收用例
```

所有新增产品能力至少关联一个 PRD ID。涉及写操作时，必须同时说明授权、幂等、并发、审计和事务边界；涉及报告时，必须说明数据版本、模板版本、领域画像/专业包版本和发布门禁。

## 5. v1 架构宪法

1. AI 不能批准需求、基线和正式报告。
2. 正式陈述必须追踪到证据或已批准的 Driver/Decision 链。
3. 事实、推断、假设、未知、候选、冲突和决策必须分开。
4. 原始材料、确认记录和已发布报告不可原地覆盖。
5. 报告只能从指定的已批准版本化基线编译。
6. 真实变化必须产生新版本和影响分析；预演不能修改正式数据。
7. 封存测试集不得进入运行时 Prompt、Few-shot 或规则调优输入。
8. 浏览器不得持有 DeepSeek API Key。
9. 真实 AI 使用必须关联用户同意的有效协议版本；用户未同意或已撤回时不得发起新的模型调用。
10. Demo 输出必须明确标记为模拟，不得伪装成真实 AI 分析。
11. Agent + Skill 只能作为受控、可审计、可停止的后端运行时；不得演化为绕过状态机、Schema Gate、权限和人工关口的自治多 Agent。

五步快速问诊、正式项目七章节治理候选、三个人工关口、轻量训练交互、12 章 Demo PDF、Flash/Pro 分工和领域画像机制不属于不可修改宪法，均为 `[H]` 或 `[E]`，应根据评估结果调整。

共享枚举的业务语义由 ADD 定义，线上字符串值与可空性由 OpenAPI 定义，API 设计负责解释使用语义，数据库 CHECK 必须逐值镜像 OpenAPI；任何一处增删枚举都要在同一变更中更新 ADD、API 设计、OpenAPI、数据库设计、迁移和契约测试。逻辑实体与关系由 ADD 定义，数据库可以规范化或增加实现字段，但不得删除报告、门禁或追踪依赖的语义；如采用不同表名或关系形态，数据库设计必须给出明确映射。

## 6. 当前实施策略

当前采用“真实链路优先 + 演示链路保留 + 三模式浏览器验收”的实施策略：

- 快速问诊已从纯示例体验推进到真实后端链路：自定义输入通过 HTTP API 创建会话，后端 Job 调用受控 Skill Runtime，输出追问、理解、方案和概述/详细报告两类简报；示例路径仍可保留固定脚本用于演示。
- 正式项目首期已从七段式叙事重构为“左侧对话 + 需求地图工作台”：首页建档和快速简报升级都会启动 `formal_guidance` Job，生成 `formal_map_snapshot`、正式项目追问和报告投影；完整基线、发布、变更和多角色确认仍是后续正式项目能力。
- 表达训练首期已接入训练 Job、Training Runtime、DeepSeek 角色回答/教练反馈、训练回合恢复和审计链；当前重点是通过真实浏览器验证追问体验、刷新恢复、反馈质量、文案自然度和移动端布局。
- 前端继续保留 MockTransport/案例脚本作为演示和回归手段，但当前主开发验收以 `NEXT_PUBLIC_API_TRANSPORT=http` 连接真实后端为准；浏览器不得持有 DeepSeek API Key。
- 后端真实 AI 运行时采用单 Orchestrator Agent + 版本化 Skill Registry：`task_type` 仍是 API/队列契约，内部映射到固定 AgentPlan，并记录 AgentRun/SkillRun/AiRun 审计链。
- 用户可见品牌统一为“需求问诊室 / Requirements Clinic”；示例、自定义、未开放能力和内部状态词按 09 的产品语言规范映射，不再在普通界面暴露工程命名。
- 发布准入与设计评审以 10 号文档记录当前浏览器证据、修复清单、token 审计和剩余 P3 事项；“发布就绪”必须同时满足实现、测试和浏览器验收。
- 当前坚持模块化单体、SQLite、持久化 Job + 轮询、服务端模型调用和确定性兜底；只有评估和实际负载触发条件成立后，才启用动态专业包、SSE、outbox、工作流引擎、向量检索或微服务。

## 7. 变更检查

文档变更合入前至少检查：

- 标题编号和相对链接有效；
- PRD ID 在相关 API/数据库章节可追踪；
- 枚举、状态和字段名称没有跨文档冲突；
- API 设计与 OpenAPI 的路径、字段、示例、错误和状态码同步，OpenAPI 示例通过 Schema 校验；
- 已启用的 Mock handler 均绑定 OpenAPI operationId 并通过契约测试；演示构建不访问开发或生产业务 API；
- Demo 行为与真实系统行为被明确区分；
- 未完成内容标为 Draft 或明确移交，不使用“已实现”措辞；
- FSD 更新时补齐 PRD 各项的页面和异常状态覆盖。

文档中的 `Baseline` 表示该层的目标设计已经可以受控变更，不表示对应代码已经完成；只有文档、实现、自动检查和人工验收同时满足发布准入，才能使用“发布就绪”。
