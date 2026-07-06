# 需求问诊室 · 前端设计规格 v2.3

> 文档状态：Frontend Spec v2.3（对齐 PRD v2.3 / ADD v1.5 / API v1.3 / DB v1.3 当前实现）
> 适用范围：真实 HTTP 后端与 MockTransport 演示双轨；快速问诊、正式项目和表达训练均已接真实链路，演示链路保留为回归手段
> 更新日期：2026-07-05
> 上游约束：[PRD](./01-PRD.md)、[ADD](./02-architecture.md)、[API](./03-api-design.md)、[OpenAPI](./03-api-openapi.yaml)、[数据库设计](./04-database-design.md)

> **v2.1 主要变更**：
> - 新增 Job 轮询 UI 组件，覆盖 API §2.4 全部 8 个 AI 写命令的 `202 Accepted` + `job_id` 异步响应与状态机（queued/running/validating/retry_wait/manual_review/succeeded/failed/cancelled）
> - 起始页协议同意从单勾选改为多步骤流程（游客会话签发 → 获取协议 → 展示正文 → 提交同意 → AGREEMENT_REQUIRED 引导），对齐 API §3A/§3B
> - 新增游客会话管理：页面通过 current 端点恢复会话，不尝试读取 HttpOnly Cookie；已登录用户可凭登录会话 + 游客 Cookie 认领指定快速问诊会话；`session_key` 不存 Web Storage
> - 简化快速问诊信息密度：默认仅显示 4 个核心卡片，其余经「高级视图」展开；状态徽章由 8 种收敛为 3 种（已确认/待确认/阻断）；移除框选交互，保留 Ctrl+点击多选
> - 新增快速问诊删除会话流程（DELETE 端点 + 30 天物理清除 `estimated_purge_at` + 409 LEGAL_HOLD 提示）
> - 需求简报导出移除 HTML 选项，明确两步下载流程；新增简报可用性反馈（§4.6）与升级正式项目细节（§4.7）
> - 表达训练新增案例选择页（§5.0），反馈页移除雷达图改为总分条形图 + 缺失维度列表
> - 删除 ADD v1.4 已移除的「出站策略」残留字段（见 §6.3 建档阶段）
> - 设计令牌：display 字体改为衬线（Source Serif Pro / Noto Serif SC）与 sans body 配对，避免 Inter 单字族 slop；强调色由深青改为暖琥珀，避免 GitHub-dark 偷懒解；新增 Job 状态色

> **v2.2 一致性修订**：
> - 对齐 ADR-023：页面与状态机只依赖统一 ApiClient；演示链路不访问真实业务网络，自定义输入经 MockTransport 创建本地会话，Fixture 只由 Mock handler 读取
> - 修复 HttpOnly Cookie 检测、协议 `content_ref`、重大更新判断、Job 重试幂等键和删除任务跟踪等不可执行描述
> - 将动态背景收敛为产品级视觉资产：演示链路和真实链路共用同一背景组件、动效参数和降级策略；避免廉价 AI 感，但不取消动效
> - 对齐 OpenAPI：修正 Source 枚举、变化预演 `201`、报告下载 `200/302`、训练 `summarizing` 状态及不存在的列表/创建端点
> - 将原上游接口缺口清单改为已补齐的真实 HTTP 读取契约清单；Mock 与真实 HTTP 共用同一 operation 和 Schema
> - 固化演示/真实视觉一致性：演示链路只替换传输层和数据源，不使用不同页面、不同按钮文案、不同配色或“演示版”外观

> **v2.3 当前实现对齐**：
> - 快速问诊页面已落地为 `/quick`、`/quick/[sessionId]`、`/quick/[sessionId]/brief`，真实自定义链路通过 `HttpTransport` 访问后端，案例链路保留演示脚本。
> - 正式项目页面已落地为 `/formal/new` 与 `/formal/[projectId]`，主工作台从旧七段式页面改为“左侧对话 + 需求地图工作台”，并接入 `formal_guidance` Job。
> - 表达训练页面已落地为 `/training/cases` 与 `/training/[attemptId]`，角色回答和反馈已接真实训练 Runtime；训练回合恢复、反馈质量和移动端体验继续按 08 验收。
> - 当前文档不再使用旧分期作为开发状态；新的开发验收优先使用真实 HTTP 后端，MockTransport 只用于演示和回归。

---

## 0. 文档定位

本文定义需求问诊室的前端页面结构、交互、状态、响应式、无障碍、打印和实现差异。业务承诺以 PRD 为准，状态与安全不变量以 ADD 为准，端点语义以 API 设计为准，物理字段以数据库设计为准。本规格必须标注数据来源和触发命令，但正式用户界面不得展示 API 路径、数据库表名、Mock、Fixture、内部开发阶段或“开发核对条”；这些信息只进入开发模式调试面板、测试定位属性和文档。

### 0.1 三种模式与页面映射

| 模式 | 主页面架构 | 适用分屏 | 核心交互 | 信息密度 |
|---|---|---|---|---|
| 快速问诊（P0 默认） | 左右分屏（对话 + 可视化卡片） | 是 | 回答 AI 追问、引用右侧卡片修改理解、查看方案与简报 | 适中，普通模式逐步披露，高级视图显示更多内容 |
| 正式项目（P1 高级） | 左侧对话 + 需求地图工作台 | 是 | 填写建档信息或从快速简报升级，AI 追问并更新可扩展地图和报告投影 | 高密度但分层展示，节点数量按主题变化 |
| 表达训练（P2 试验） | 案例选择 + 左右分屏 | 是 | 用户练习追问，AI 扮演角色，提交总结后查看反馈 | 适中，重点在练习提示和反馈 |

### 0.2 当前实现映射

| 页面/能力 | 当前组件或文件 | 当前状态 | v2.2 目标 |
|---|---|---|---|
| 起始页 | `ReqClinic/app/page.tsx` 及 start 组件 | 已实现三模式同级入口 | 继续检查文案层级、返回语义和移动端首屏 |
| 快速问诊入口 | `ReqClinic/app/quick/page.tsx`、`components/start/quick-mode-page.tsx` | 已实现真实输入与案例演示双轨 | 自定义输入走真实后端；案例点击直接进入 sample 演示 |
| 快速问诊会话 | `components/quick/quick-consult-page.tsx`、`quick-dialogue.tsx`、`quick-visualization.tsx` | 已实现真实链路与演示链路，支持卡片引用和方案/简报 | 继续精修卡片动效、等待态和移动端整理视图 |
| 需求简报 | `ReqClinic/app/quick/[sessionId]/brief/page.tsx` | 已实现概述/详细报告、继续补充和升级正式项目入口 | 详细报告渲染与导出内容保持一致 |
| 正式项目建档 | `ReqClinic/app/formal/new/page.tsx`、`components/formal/formal-new-page.tsx` | 已实现表单建档、案例选择和真实 `formal_guidance` 创建 | 保持不要求用户一次性写清完整需求 |
| 正式项目工作台 | `ReqClinic/app/formal/[projectId]/page.tsx`、`components/formal/formal-analysis-page.tsx` | 已实现左侧对话 + 可扩展需求地图 + 报告投影 | 后续补完整正式基线、发布、变更治理 |
| 表达训练案例页 | `ReqClinic/app/training/cases/page.tsx`、`training-case-select.tsx` | 已实现案例选择和创建 attempt | 继续检查案例区分度、首屏理解和移动端卡片可用性 |
| 表达训练对话页 | `ReqClinic/app/training/[attemptId]/page.tsx`、`training-split-page.tsx` | 已接 `training_response` 真实 job，服务端消息恢复和角色回答 | 继续检查无意义追问、等待态、刷新恢复和文案自然度 |
| 表达训练反馈页 | `training-feedback.tsx` | 已接 `training_feedback` 真实 job，并统一后端/前端反馈字段 | 继续检查反馈专业度、普通用户可读性和再练/完成闭环 |
| 传输层 | `ReqClinic/lib/api/http-transport.ts`、`client.ts` | 支持 MockTransport/HttpTransport 双轨 | 真实开发验收默认使用 HTTP；Mock 只用于演示和回归 |

"已实现"只表示当前代码中存在对应页面或链路，不等于已通过可用性、无障碍、模型质量或生产安全验收。表达训练虽然已接真实 Runtime，仍必须通过真实浏览器验收确认角色回答、反馈质量、刷新恢复和移动端体验。

### 0.3 已补齐的真实 HTTP 读取契约

以下页面能力已在 API Markdown、OpenAPI 与数据库映射中补齐。演示链路通过 MockTransport 返回同一 operationId 和 Schema；真实链路通过 HttpTransport 请求同一路径。前端不得再依赖浏览器缓存、隐藏接口或 Fixture 专用字段来完成恢复与历史导航。

| 页面能力 | 真实 HTTP 契约 | 页面使用规则 |
|---|---|---|
| 快速问诊消息历史与当前问题恢复 | `GET /api/quick-sessions/:id/messages` | 刷新或返回问诊页时恢复 turns/current_question；不得重新发送 `POST /messages` 来重建问题 |
| 简报完整版本列表 | `GET /api/quick-sessions/:id/briefs` | 版本切换先读列表，再按版本读 `GET /briefs/:version` |
| 正式基线历史 | `GET /api/projects/:id/baselines` | 范围确认页展示完整版本历史，不只依赖项目摘要里的 current_baseline |
| 正式报告历史 | `GET /api/projects/:id/reports` | 分析报告页展示报告版本、状态、门禁和下载入口 |
| 真实变化历史 | `GET /api/projects/:id/changes` | 终态变化页展示真实变化列表；预演仍单独读取，不混入真实历史 |
| 正式访谈与角色 | `GET /api/projects/:id/interview-turns`、`GET /api/projects/:id/stakeholders` | 访谈页可恢复消息和角色筛选；快速问诊 `quick_turns` 不复用为正式访谈 |
| 实体证据与追踪 | `GET /api/projects/:id/evidence-links`、`GET /api/projects/:id/trace-links` | 从实体跳转证据必须通过关系端点；不得把实体 ID 当 Evidence ID |
| 冲突详情与候选方案 | `GET /api/conflicts/:id` | 冲突页先读详情后显示双方观点和方案比较，再提交 resolve |
| 训练反馈就绪 | `GET /api/training-attempts/:id` | 提交总结后轮询 Attempt 状态；`feedback_ready` 后再读反馈 |
| 训练评分依据与改进示例 | `GET /api/training-attempts/:id/feedback` | 反馈页展示总分、遗漏、逐维依据和改进示例，不从自由文本建议里猜结构 |
| 登录、登出和账户恢复 | `GET /api/auth/session`、`POST /api/auth/logout`、`POST /api/auth/recovery/start` | 页面只依赖产品会话契约；真实登录/注册/OIDC 回调由身份模块实现 |

### 0.4 演示/真实链路视觉一致性

演示链路和真实链路必须使用同一产品界面。MockTransport 只替换传输层和数据源，不允许形成另一套“演示版 UI”。用户可见层必须满足：

- 同一页面结构、导航、组件、配色、字体、间距、动效和响应式规则；
- 同一主按钮文案和操作命名，例如起始页统一为“开始问诊”；
- 不出现“Mock / Fixture / 演示模式”等技术或项目阶段字样；
- 不用额外底栏、横幅、特殊背景或水印区分阶段；
- 差异只允许存在于传输层、数据源、开发调试抽屉、测试属性和导出/报告的内容来源说明。
- 动态背景、进入动画、页面过渡和状态动效必须共用同一实现与参数；不得为演示链路单独做“演示感”背景，也不得为真实链路移除品牌动效。

内容来源仍必须诚实：预生成内容用与真实系统相同的来源/状态组件标注为“示例数据”或“模拟结果”；真实链路对应位置标注“用户输入”“系统分析”“人工确认”等来源。标注组件的位置、尺寸和样式保持一致，不形成两套视觉。

### 0.5 页面文案原则

页面面向普通用户，不解释架构。默认规则：

- 主标题一句话，副标题不超过 40 个汉字；
- 主流程页只保留当前任务、下一步动作、必要风险和可恢复错误；
- 详细说明进入抽屉、tooltip、帮助链接或导出物，不占用主工作区；
- 页面不展示 API 路径、数据库字段、阶段名、契约缺口、Fixture 名称或测试术语；
- 同一信息不在标题、卡片、提示条和按钮旁重复出现。

---

## 1. 全局设计令牌

### 1.1 设计语言

设计语言来自产品本身的“问诊—判断—形成可用说明”过程：像一张经过审校的工作底稿，强调证据、状态、差异和下一步；display 字体使用衬线增加编辑性温度。核心原则：

- **节制**：颜色少而精确，每个颜色有明确职责；阴影克制，1-2 级深度
- **精确**：1px 对齐，icon 大小一致，字号层级清晰，靠字重和字号建立秩序
- **反馈**：所有交互 100ms 内有视觉反馈；状态变化有 150ms transition
- **密度有节奏**：默认舒适密度，提供紧凑切换；首屏克制，渐进披露

避免的"AI 感"：紫色/蓝色渐变滥用、玻璃拟物过度、大圆角堆叠（16px+）、动画无目的、深蓝底+通用青/紫霓虹 glow（GitHub-dark 偷懒解）、Inter 单字族、emoji 图标、圆角卡片+左 border accent。允许动态背景，但必须服务于“问诊、梳理、形成文档”的产品气质，而不是通用 AI 炫技。

### 1.2 色彩系统

```css
:root {
  /* 主色 - 深靛蓝（专业、克制、不 AI 感） */
  --primary-900: #0f172a;
  --primary-800: #1e293b;
  --primary-700: #334155;
  --primary-600: #475569;
  --primary-500: #64748b;

  /* 强调色 - 暖琥珀（用于焦点、激活、主操作；带温度，避免冷青偷懒解） */
  --accent-700: #9a3412;
  --accent-600: #c2410c;
  --accent-500: #ea580c;
  --accent-100: #ffedd5;
  --accent-50: #fff7ed;

  /* 状态色 - 只用于状态标识，不用于装饰 */
  --success-700: #15803d;
  --success-100: #dcfce7;
  --warning-700: #b45309;
  --warning-100: #fef3c7;
  --danger-700: #b91c1c;
  --danger-100: #fee2e2;
  --info-700: #1d4ed8;
  --info-100: #dbeafe;

  /* Job 状态色 - 仅用于异步任务状态标识 */
  --job-queued: #1d4ed8;        /* 蓝：排队中 */
  --job-running: #0891b2;       /* 青：处理中 */
  --job-validating: #0369a1;    /* 深蓝：校验中 */
  --job-retry-wait: #b45309;    /* 琥珀：重试退避中 */
  --job-manual-review: #be185d; /* 玫红：需人工处理 */
  --job-succeeded: #15803d;      /* 绿：成功 */
  --job-failed: #b91c1c;        /* 红：失败 */
  --job-cancelled: #64748b;     /* 灰：已取消 */

  /* 中性色阶 - 文字、边框、背景 */
  --slate-900: #0f172a;
  --slate-800: #1e293b;
  --slate-700: #334155;
  --slate-600: #475569;
  --slate-500: #64748b;
  --slate-400: #94a3b8;
  --slate-300: #cbd5e1;
  --slate-200: #e2e8f0;
  --slate-100: #f1f5f9;
  --slate-50: #f8fafc;

  /* 语义色 */
  --bg-canvas: #fafafa;
  --bg-surface: #ffffff;
  --bg-subtle: #f1f5f9;
  --bg-hover: #f8fafc;
  --bg-selected: #fff7ed;       /* 选中背景跟随暖琥珀强调色 */
  --bg-inverse: #0f172a;

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-tertiary: #64748b;
  --text-disabled: #64748b;
  --text-inverse: #f8fafc;

  --border-default: #e2e8f0;
  --border-strong: #cbd5e1;
  --border-focus: #ea580c;       /* 焦点边框跟随强调色 */
  --border-selected: #c2410c;

  /* 阴影 - 只两级 */
  --shadow-1: 0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
  --shadow-2: 0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04);
  --shadow-overlay: 0 12px 32px rgba(15, 23, 42, 0.12), 0 4px 8px rgba(15, 23, 42, 0.06);

  /* 圆角 - 统一 6px */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-full: 9999px;

  /* 间距 - 4px 基础倍数 */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --space-12: 48px; --space-16: 64px;

  /* 字号 */
  --font-size-xs: 11px; --font-size-sm: 12px; --font-size-base: 14px;
  --font-size-md: 15px; --font-size-lg: 16px; --font-size-xl: 18px;
  --font-size-2xl: 20px; --font-size-3xl: 24px; --font-size-4xl: 32px;

  /* 行高 */
  --line-height-tight: 1.25; --line-height-normal: 1.5; --line-height-relaxed: 1.625;

  /* 字重 */
  --font-weight-normal: 400; --font-weight-medium: 500;
  --font-weight-semibold: 600; --font-weight-bold: 700;

  /* 动效 - 150ms 默认，不超过 200ms */
  --duration-fast: 100ms; --duration-normal: 150ms; --duration-slow: 200ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);

  /* 字体 - 衬线 display + sans body 配对，避免 Inter 单字族 slop */
  --font-display: "Source Serif Pro", "Noto Serif SC", "Source Han Serif SC", Georgia, "Times New Roman", serif;
  --font-sans: "Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;

  /* 布局 */
  --header-height: 56px;
  --sidebar-width: 240px;
  --right-panel-width: 320px;
  --split-default: 45%;
  --split-min: 25%;
  --split-max: 75%;
  --content-max-width: 1320px;
}
```

### 1.3 密度模式

v2.2 只交付舒适密度：默认行高 44px、正文 14px、卡片间距 16px。紧凑/宽松切换没有当前 PRD 承诺，不暴露设置项，也不写入 localStorage；若形成性评估证明需要，再按 §11.5 立项。

### 1.4 字体层级

| 用途 | 字号 | 字重 | 字体 | 行高 | 用例 |
|---|---|---|---|---|---|
| 页面标题 | 24px | 700 | display | 1.25 | 起始页 h1 |
| 区域标题 | 20px | 700 | display | 1.25 | 页面内主区块 |
| 卡片标题 | 16px | 600 | sans | 1.25 | 卡片/面板标题 |
| 正文 | 14px | 400 | sans | 1.5 | 默认正文 |
| 辅助文字 | 13px | 400 | sans | 1.5 | 次要说明 |
| 小字 | 12px | 500 | sans | 1.4 | 标签、时间、ID |
| 极小字 | 11px | 600 | sans | 1.3 | 徽章、UPPERCASE 标签 |
| 等宽 | 13px | 500 | mono | 1.4 | ID、版本号、代码 |

### 1.5 组件规格

| 组件 | 规格 |
|---|---|
| 按钮 | 高 36px（regular）/ 32px（compact）/ 40px（large）；padding 12px 16px；radius 6px；font-weight 600 |
| 输入框 | 高 36px；padding 8px 12px；radius 6px；border 1px solid var(--border-default) |
| Textarea | padding 8px 12px；radius 6px；resize: none |
| 卡片 | padding 16px；radius 8px；border 1px solid var(--border-default)；background var(--bg-surface) |
| 徽章 | padding 2px 8px；radius full；font-size 11px；font-weight 600 |
| 图标 | 16px（行内）/ 18px（按钮内）/ 20px（标题旁）；stroke-width 1.5px |
| 表格行 | 高 44px（舒适）/ 36px（紧凑）；padding 8px 12px |
| 分割条 | 宽 4px；hover 时 8px；background var(--slate-300)；active 时 var(--accent-600) |

**不可执行按钮状态**：
- 原生 `disabled` 用于无需解释且无需聚焦的动作；它不可聚焦，不额外声明 `aria-disabled`。
- 需要让键盘和读屏用户了解原因时，使用可聚焦元素 + `aria-disabled="true"`，阻止点击/键盘提交，并在关联说明中给出阻断原因；仍保留 focus ring。
- 两类视觉统一为 background var(--slate-100)、color var(--text-disabled)、border 1px solid var(--border-default)、cursor not-allowed、opacity 1、hover 无变化。

### 1.6 动效规格

- 状态切换 transition：150ms ease-default
- 新内容滑入：200ms ease-out（translateY 8px → 0 + opacity 0 → 1）
- 删除淡出：150ms ease-in（opacity 1 → 0）
- 骨架屏 shimmer：1.5s linear infinite
- 请求 < 500ms 不显示 loading；> 500ms 显示骨架屏
- Job 轮询：500ms 起显示状态条，状态变化 150ms transition
- `prefers-reduced-motion: reduce` 时所有动效降为 0ms

### 1.7 图标系统

使用 Lucide Icons（stroke 风格，1.5px 线宽），不使用 emoji。状态图标统一：
- 成功：CheckCircle（绿）
- 警告：AlertTriangle（琥珀）
- 危险：XCircle（红）
- 信息：Info（蓝）
- 进行中：Loader（旋转，青）
- 未知：HelpCircle（灰）
- Job 状态：见 §1.2 Job 状态色，搭配对应圆点 + 文字标签，不以颜色为唯一表达

### 1.8 动态背景规范

动态背景是需求问诊室的品牌资产，演示链路和真实链路必须完全共用。推荐方向是“可编辑工作底稿 + 问诊流动感”：轻微网格、缓慢流动的焦点光、少量路径线或节点，不使用强霓虹、强玻璃、粒子爆炸或高频运动。

允许实现方式：

- CSS gradient / SVG filter / Canvas / WebGL 均可；
- 背景组件只接收主题、尺寸和 reduced-motion 状态，不接收演示/真实分支参数；
- 起始页、快速问诊和正式项目可以使用同一背景系统的不同密度层级，但不能换成两套风格。

性能与可访问性约束：

- 背景不得阻塞首屏输入；LCP 目标仍按 PRD/ADD 非功能指标执行；
- 动画默认低速，页面稳定后运行；CPU 占用异常时自动降级为静态帧；
- `prefers-reduced-motion: reduce` 时保留静态构图，移除持续运动；
- 背景对正文对比度影响不得超过 WCAG 可读性要求，文字区域必须有稳定实色承载层；
- 移动端可降低帧率、减少层数或使用静态关键帧，但视觉语言保持一致。

---

## 2. 起始页

> PRD ID：PRD-POS-001、PRD-MODE-001、PRD-ENTRY-001

### 2.1 目的与布局

起始页是用户进入需求问诊室的入口，目标是让用户先用一句话给出当前想法；后续由 AI 通过追问引导澄清，不要求用户自己组织完整需求。

布局采用克制但有记忆点的编辑工作台式入口：
- 全屏浅色画布 + 动态背景组件：轻微网格、缓慢光带或路径线，表达“梳理想法”的过程感
- 居中 prompt bar（主输入区）
- 下方示例卡片入口（快速问诊示例 + 正式项目示例 + 训练入口）

```text
┌──────────────────────────────────────────────────────────┐
│  [浅色工作画布 · 低速动态背景 · 稳定输入承载层]           │
│                                                          │
│                    需求问诊室                             │
│             需求分析 is all you need                       │
│                                                          │
│      ┌──────────────────────────────────────────┐       │
│      │  先用一句话说说你的想法，剩下我来问        │       │
│      │  [textarea: 输入你的想法...]              │       │
│      │                         [开始问诊 →]    │       │
│      └──────────────────────────────────────────┘       │
│         ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│         │ AI 海报   │ │ Aster    │ │ 表达训练 │         │
│         │ 生成网站  │ │ 园区访客  │ │ 练习沟通 │         │
│         └──────────┘ └──────────┘ └──────────┘         │
└──────────────────────────────────────────────────────────┘
```

### 2.2 背景与产品识别

**视觉规格**：
- 背景使用 `var(--bg-canvas)`；叠加不高于 6% 对比度的动态网格、路径线或柔和光带；
- 可使用 WebGL/Canvas/CSS/SVG，但必须满足 §1.8 性能与可访问性约束；不使用高频粒子、强鼠标跟随、强视差或遮挡正文的光斑；
- Prompt Bar 使用实色 `var(--bg-surface)`、1px 边框和 `var(--shadow-1)`，不使用大面积玻璃拟物；
- 产品识别签名固定为“输入想法 → 追问澄清 → 形成需求简报”；不轮播虚构角色、项目指标或与当前输入无关的内容；
- 示例被选择后，在来源组件中显示“示例数据”；选择前不冒充正在分析真实项目。

### 2.3 居中 Prompt Bar

> PRD ID：PRD-AGREEMENT-001

**字段**：

| 字段 | 必填 | 类型 | API 字段 | 说明 |
|---|---:|---|---|---|
| 原始想法 | 是 | textarea | `original_input` → `quick_sessions.original_input` | 1-10,000 字，去空白后非空；placeholder 使用 var(--slate-500)；不可变 |

首屏只显示“原始想法”。`intent` 和 `decision_intent` 不作为独立输入框常驻页面；如需要，可在 textarea 下方用轻量 chip 或折叠“补充用途”承载，默认不增加用户负担。

**交互**：
- Prompt bar 为实色 `var(--bg-surface)` 卡片，使用 1px 边框和 `var(--shadow-1)`
- "开始问诊"主按钮（accent 色）；textarea 中 Enter 换行，`Ctrl/Cmd+Enter` 提交，并正确忽略中文输入法 composition 过程中的 Enter
- 自定义输入不与预置案例结论混用

**传输层分流**：

- 演示链路和真实链路页面均调用同一 ApiClient operation；演示链路由 MockTransport 返回本地会话和预生成结果，真实链路由 HttpTransport 调用 `/api/v1`；
- 自定义输入在演示链路创建本地 Mock 会话，不访问真实业务网络；若当前 Mock 数据不足以生成对应分析，页面仍保持同一流程，只在来源组件或结果空状态中提示“当前仅提供示例数据”；
- 示例入口同样通过 ApiClient 调用 `source_kind=sample` 的 operation，返回预置案例；
- 真实链路在同意协议后创建真实快速问诊会话。

主按钮文案统一为“开始问诊”。演示链路不允许把该按钮做成“保存草稿”或其他演示态文案；如果只能保存草稿，该功能必须降级到次要操作，不能占据主按钮。

**协议同意流程**（对齐 API §3A/§3B；演示链路使用同形 Mock 响应，真实链路调用真实端点）：

1. **恢复或签发游客会话**：浏览器不能读取 HttpOnly Cookie。页面直接调用 `GET /api/guest-sessions/current`；成功则恢复，`401/404` 才调用 `POST /api/guest-sessions`。签发响应虽一次性包含 `session_key`，浏览器实现只依赖同时下发的 HttpOnly Cookie，不把原始值写入 JS Store、日志或 Web Storage
2. **获取当前有效协议**：调用 `GET /api/agreements/active`，只使用契约中的 `id`、`version`、`change_type`、`effective_at`、`content_ref`；再通过 `GET /api/agreements/consents` 判断当前主体是否已有对应有效同意
3. **展示协议入口**：`content_ref` 是协议正文 URL，不假定响应内存在 `summary` 或可跨域内嵌正文；显示版本、生效时间、“阅读完整协议”安全链接和主动勾选框。协议正文内容本期仍由单独法律任务提供
4. **提交同意**：用户勾选并点击“同意并开始”，调用 `POST /api/agreements/:versionId/accept`（请求体 `scope` 按入口取 quick/formal/training，只有协议明确覆盖全部模式时才用 all；需 `Idempotency-Key`）；成功后继续原提交动作
5. **AGREEMENT_REQUIRED 引导**：提交"开始问诊"时若返回 `403 AGREEMENT_REQUIRED`（`retryable=false`），回到步骤 2 重新获取协议并展示

**重新同意（reaccept）**：协议版本更新且服务端标记 `change_type=major` 时，用户已有旧版同意但需重新同意。
- **触发场景**：当前协议 ID 没有有效同意且 `change_type=major`；前端不得通过版本字符串自行推断重大更新
- **API 调用**：`POST /api/agreements/:versionId/reaccept`（需 `Idempotency-Key`）
- **UI 元素**：版本对比视图（左旧右新，差异高亮）+ "我已了解变更，重新同意"按钮
- **状态转换**：成功后 AGREEMENT_REQUIRED 解除，可继续使用

**撤回同意（withdraw）**：用户主动撤回已给的协议同意。
- **触发场景**：用户在协议状态行或设置页点击"撤回同意"
- **API 调用**：`POST /api/agreements/consents/:id/withdraw`（需 `Idempotency-Key`）
- **UI 元素**：撤回确认弹窗（明确告知后果：阻止新的 AI 调用、已有数据保留但无法继续分析）+ 二次确认输入"撤回"文字
- **状态转换**：撤回后所有 AI 写命令返回 `403 AGREEMENT_REQUIRED`

**历史同意记录（consents）**：用户查看自己的协议同意历史。
- **触发场景**：用户在设置/账户页或协议状态行点击"查看历史"
- **API 调用**：`GET /api/agreements/consents`（分页）
- **UI 元素**：时间线视图按契约显示协议版本、发生时间、scope 和 action（accepted/reaccepted/withdrawn）；“当前是否有效”由当前协议 + 事件链计算结果单独呈现，不伪造 status 字段
- **入口**：设置/账户页或协议状态行点击查看

**校验**：
- 原始想法为空时"开始问诊"按钮禁用
- 超过 10,000 字时实时提示
- 真实链路协议未同意时主按钮仍可聚焦和触发协议步骤，但在同意完成前不得发送真实 AI 命令；不用仅 hover 可见的 tooltip 承载原因
- 演示链路不在主按钮旁显示演示解释；示例/模拟来源只进入统一来源组件

### 2.4 示例卡片入口

三张卡片水平排列，等宽：

| 卡片 | 标题 | 副标题 | 图标 | 行为 |
|---|---|---|---|---|
| 快速问诊示例 | AI 海报生成网站 | 从一句话到需求简报 | Sparkles | 进入 AI 海报示例 |
| 正式项目示例 | Aster 园区访客预约 | 正式项目完整分析 | Building2 | 进入 Aster 正式项目示例 |
| 表达训练 | 练习需求沟通 | 角色扮演训练 | GraduationCap | 进入训练流程；演示链路由 MockTransport 返回固定案例，真实链路读取案例列表（§5.0） |

**卡片样式**：
- 实色 `var(--bg-surface)` 卡片（同 prompt bar 风格）
- hover 时轻微上浮（translateY -2px）+ 阴影增强
- 图标 24px，accent 色
- 标题 16px semibold，副标题 13px regular secondary

### 2.5 模式选择逻辑

- 用户直接输入并点击“开始问诊” → 默认进入快速问诊（演示链路为 Mock 会话，真实链路为真实会话，均使用 `source_kind=custom`）
- 用户点击示例卡片 → 载入对应 Fixture 并进入对应模式（`source_kind=sample`，`source_case_id` 指定案例）
- 用户点击训练卡片 → 进入训练案例选择页（§5.0）
- 系统可根据输入内容提出模式建议（候选），但最终模式由用户选择
- 模式建议不得阻止用户开始问诊；保存草稿只能作为次要操作

**模式建议 UI 载体**：建议在 prompt bar 下方作为 chip 行展示（如"检测到正式项目特征，建议创建正式项目 →"），用户可点击接受或忽略，不阻塞主按钮；chip 样式为 `var(--info-100)` 底 + `var(--info-700)` 文字 + 4px 圆角。

### 2.6 内容来源标识

页面不使用独立“演示模式”底栏。需要说明内容来源时，统一使用来源 chip 或状态条：

| 场景 | 文案 | 位置 |
|---|---|---|
| 演示示例内容 | 示例数据 | 对应结果卡片、报告页元信息、导出物页脚 |
| 演示模拟 AI 结果 | 模拟结果 | AI 消息、需求简报、正式报告摘要 |
| 真实用户输入 | 用户输入 | 原始想法、访谈材料、证据来源 |
| 真实系统分析 | 系统分析 | AI 建议、候选需求、风险提示 |
| 人工确认内容 | 已确认 | 关口、范围、发布报告 |

来源 chip 使用同一组件规格：11px medium，`var(--bg-subtle)` 背景，`var(--text-tertiary)` 文字，radius full。演示/真实只改变文案，不改变样式和布局。

### 2.7 响应式

| 宽度 | 规则 |
|---|---|
| > 768px | 居中布局，prompt bar 最大宽度 640px，卡片水平排列 |
| ≤ 768px | 全宽布局，卡片纵向排列，prompt bar padding 16px |
| ≤ 480px | 保持正文不小于 14px、触控目标不小于 44×44px；隐藏非必要卡片图标和次要说明 |

### 2.8 游客会话管理

> PRD ID：PRD-IDENTITY-001、PRD-AUTH-001

**页面加载会话检测**（真实链路，对齐 API §3A.2）：
- 不检测 HttpOnly `guest_session` Cookie 是否存在，直接调用 `GET /api/guest-sessions/current`
- 成功则恢复会话（响应**不返回 `session_key`**，原始凭证只签发一次）
- `401/404` 才按 §2.3 步骤 1 签发新会话；网络错误不签发第二个会话，显示恢复动作
- 已登录用户（持 `actor_kind=user`）跳过游客会话逻辑

**会话认领**（对齐 API §3A.3，已登录用户认领游客会话）：
- 入口：登录后在起始页或快速问诊页显示"认领此游客会话"提示（当检测到当前为游客会话且存在可认领的快速问诊会话时）
- 调用 `POST /api/quick-sessions/:id/claim`（需 `Idempotency-Key`，`:id` 为要认领的快速问诊会话 ID）
- 认领为双因子认证流程：游客凭证（Cookie/Header）+ 登录凭证，服务端校验两因子后将会话归属从游客迁移到用户
- 认领成功后会话数据不变，后续操作以用户身份进行
- 认领超时（10s）返回 `504 REQUEST_TIMEOUT`，保留游客访问

**安全约束**：
- 签发响应一次性返回 `session_key` 并同时设置 HttpOnly/Secure/SameSite=Strict Cookie；浏览器前端不持久化或记录响应中的原始值，**禁止存入 localStorage 或 sessionStorage**
- 浏览器请求依赖 Cookie 自动携带凭证；`X-Session-Key` 只供能安全持有原始凭证的非浏览器客户端，网页前端不得读取 Cookie 后拼接该 Header
- 游客会话 30 天无活动按规则清理（对齐 DB §14.2）

---

## 3. 快速问诊分屏页

> PRD ID：PRD-QUICK-001、PRD-QUICK-002、PRD-COVERAGE-001、PRD-UNKNOWN-001、PRD-TOPIC-001、PRD-STATE-001

### 3.1 整体布局

快速问诊采用左右分屏布局，核心交互为"选中可视化卡片 → 引用到对话 → AI 更新可视化"：

```text
┌──────────────────────────────────────────────────────────────┐
│  顶栏：品牌 / 会话标题 / 阶段进度 / 信息覆盖概况 / [高级视图] / 操作 │
├────────────────────────┬─────────────────────────────────────┤
│   左栏：AI 对话区        │   右栏：可视化需求状态               │
│   （45% 默认，可拖拽）   │   （55% 默认，可拖拽）               │
│                        │                                     │
│  ┌──────────────────┐  │  ┌─ 当前理解摘要 ──────────────┐    │
│  │ 引用条（可多个）  │  │  │ 为…用户，在…场景，解决…问题  │    │
│  │ [目标 ×] [场景 ×] │  │  └──────────────────────────────┘    │
│  └──────────────────┘  │                                     │
│  对话消息流            │  ┌─ 覆盖槽位（6 个）──────────────┐  │
│  ┌────────────────┐   │  │ [目标 ✓] [用户 ✓] [场景 ◐]      │  │
│  │ AI: ...        │   │  │ [范围 ✗] [完成 ◐] [约束 ✗]      │  │
│  └────────────────┘   │  └──────────────────────────────┘  │
│  ┌─ Job 轮询条 ────┐  │  ┌─ 期望结果 ──┐ ┌─ 目标用户 ──┐  │
│  │ queued 排队中…   │  │  │ [可选中卡片]  │ │ [可选中卡片] │  │
│  └────────────────┘  │  └──────────────┘ └──────────────┘  │
│  ┌──────────────────┐ │  ┌─ 核心场景 ──┐ ┌─ 未知项 ────┐  │
│  │ 输入框           │ │  │ [可选中卡片]  │ │ [阻断/非阻断]│  │
│  └──────────────────┘ │  └──────────────┘ └──────────────┘  │
└────────────────────────┴─────────────────────────────────────┘
          （高级视图展开后追加：范围边界 / 完成条件 / 方案比较）
```

### 3.2 可拖拽分割条

- 分割条位于左右栏之间，宽 4px（hover 时 8px）
- 背景 var(--slate-300)，hover 时 var(--slate-400)，拖拽中 var(--accent-600)
- 拖拽时显示当前比例（如 "45% / 55%"）浮动提示
- 比例范围 25%-75%，默认 45%/55%
- 持久化到 localStorage（key: `quick-split-ratio`）
- 支持双击分割条重置为默认 45%/55%
- 键盘可聚焦，左右方向键调整 1%，Shift+方向键调整 5%
- 使用 `role="separator"`、`aria-orientation="vertical"`、`aria-valuemin/max/now`；移动端移除分割条焦点

### 3.3 左栏：AI 对话区

#### 3.3.1 引用条

用户选中右侧卡片后，左栏顶部显示引用条：

- 每个引用为一个 chip：`[图标] 卡片标题 ×`
- 支持多个引用同时存在（用户可同时选中多个卡片）
- 单个引用可点击 × 移除
- 全部移除按钮"清除所有引用"
- 引用条存在时，对话输入框上方固定显示，不可滚动隐藏
- 用户发送消息后引用条清空（引用的卡片 ID 由前端在消息 content 中以文本形式标注，不作为独立字段发送；POST /api/quick-sessions/:id/messages 请求体只有 action/content/question_id 三个字段，对齐 OpenAPI QuickSessionMessageRequest）

#### 3.3.2 对话消息流

- 消息分两类：AI 消息（左对齐）和用户消息（右对齐）
- AI 消息：
  - 头像：首字母圆形头像 + "需求问诊室"标签（不用卡通角色）
  - 内容：结构化呈现（段落 + 列表 + 表格）
  - 底部：来源链接（"基于用户第 3 轮回答"）+ 更新标记（"已更新：目标"）
  - 跟进建议按钮：2-3 个（如"换个方案"、"详细说明"、"这个会影响什么"）
- 用户消息：
  - 头像：首字母圆形头像 + "我"标签
  - 内容：纯文本，保留原始表达
- 新消息滑入动画（200ms ease-out）
- 滚动到底部按钮（当不在底部时显示）

#### 3.3.3 输入框

- 多行 textarea，resize: none
- placeholder："回答 AI 的问题；不确定也可以说不知道..."
- Enter 换行，`Ctrl/Cmd+Enter` 发送；中文输入法 composition 期间的 Enter 不触发提交
- 显示字数计数器，但 OpenAPI 当前未声明消息 `maxLength`，前端不得私自用 5,000 字硬截断；服务端返回字段校验错误时保留全文并显示契约错误
- 发送按钮（accent 色，支持快捷键 `Ctrl/Cmd+Enter`）
- 发送触发 `POST /api/quick-sessions/:id/messages`（`action=answer`，需 `Idempotency-Key`），返回 `202`（见 §3.3.4）
- 发送失败：输入内容保留，显示错误 toast，可重试

#### 3.3.4 Job 轮询组件

本节描述快速问诊场景下 Job 轮询条的插入位置与场景特定行为；通用 Job 轮询组件规格（状态机、退避策略、状态色、图标）见 §7.8 权威定义。

**触发命令**（均返回 `202 Accepted` + `job_id`）：
- 追问 `POST /api/quick-sessions/:id/messages`（`next_question`）
- 理解确认 `POST /api/quick-sessions/:id/understanding-review`（`understanding_updated`）
- 方案偏好 `POST /api/quick-sessions/:id/option-preferences`（`option_comparison`）
- 简报生成 `POST /api/quick-sessions/:id/briefs`（`brief_version`）

**场景特定展示**：
- 收到 `202` 响应后，轮询条插入左栏对话流下方，从 `status_url`（`/api/ai-jobs/:id`）轮询状态（轮询规则、退避策略、状态机见 §7.8）
- 请求 < 500ms 不显示轮询条；> 500ms 显示（对齐 §1.6）
- 成功后轮询条淡出，结果（`next_question` / `coverage_slots` / `is_blocking_unknown` 等）回填到对话流与右栏
- 失败、取消、需人工复核等通用交互与错误处理见 §7.8

### 3.4 右栏：可视化需求状态

#### 3.4.1 当前理解摘要

> PRD ID：PRD-EPI-001

顶部固定显示一行自然语言摘要：

> 为**目标用户**，在**核心场景**下，解决**问题**，达到**期望结果**。

- 缺失项显示为 `<span class="placeholder">待补充</span>`
- 数据来源 `GET /api/quick-sessions/:id/understanding`（返回 `understanding_version` + `summary` + `updated_at` + `updated_by`）；Job `understanding_updated` 返回 `new_understanding_version`，成功后以该版本重新拉取 GET；页面刷新也通过该 GET 恢复理解正文
- 背景 var(--bg-subtle)，radius 8px，padding 12px

#### 3.4.2 覆盖槽位

六类覆盖槽位以紧凑网格显示，数据来源 `GET /api/quick-sessions/:id/coverage`（`coverage_slots_json` + `quick_unknowns` 表）：

| 槽位（slot_id） | 图标 | 状态值 → 颜色 |
|---|---|---|
| 期望结果 expected_outcome | Target | covered=绿 / partial=琥珀 / not_started=灰 |
| 用户对象 user_object | Users | 同上 |
| 核心场景 core_scenario | MapPin | 同上 |
| 范围边界 scope_boundary | Filter | 同上 |
| 完成判断 completion_criteria | CheckSquare | 同上 |
| 约束风险 constraints_risks | AlertCircle | 同上 |

- 每个槽位显示为小卡片（padding 8px 12px）
- 点击槽位卡片可选中并引用到对话
- **不显示虚假的完成百分比**，也不把"回答了第几题"当成需求完整度
- 进度提示用自然语言："目标已清楚、场景待补充"
- `is_blocking_unknown=true` 的槽位角标显示阻断提示

#### 3.4.3 分块卡片（渐进式复杂度）

> PRD ID：PRD-PREFERENCE-001

默认显示 4 个核心卡片，其余经顶栏「高级视图」切换展开（对齐 PRD §3.3 渐进式复杂度）：

| 卡片 | 默认显示 | 内容 | 数据来源 |
|---|---|---|---|
| 期望结果 | 是 | 希望改变什么/获得什么 | 简报投影 + `coverage_slots` |
| 目标用户 | 是 | 主要使用者/受影响者/决策者 | 同上 |
| 核心场景 | 是 | 具体使用或发生场景 | 同上 |
| 未知项 | 是 | 阻断/非阻断未知列表 | `GET /api/quick-sessions/:id/unknowns`（支持 `status=blocking/non_blocking` 筛选，返回 `items` 数组含 `id`/`question`/`impact`/`is_blocking`/`suggested_responsible`/`suggested_info_needed`/`review_condition`/`status`）；页面刷新后通过该端点重新取回 |
| 范围边界 | 高级视图 | 本次要做/暂不做/以后做 | 简报投影 |
| 完成条件 | 高级视图 | 可观察的验收信号 | 简报投影 |
| 方案比较 | 高级视图 | 候选方案 + 取舍 + 用户偏好 | 简报 + `option-preferences` |

**方案比较卡片数据流**：先 `GET /api/quick-sessions/:id/briefs/:version` 取方案列表 → 用户选择后 `POST /api/quick-sessions/:id/option-preferences`（`option_id` + `matches_ai_recommendation`）→ 轮询 Job 结果后刷新简报。

**卡片样式**：
- 默认：border 1px solid var(--border-default)，background var(--bg-surface)
- 选中：border 1px solid var(--border-selected)，background var(--bg-selected)
- hover：轻微阴影 var(--shadow-1)
- 空内容卡片显示"待补充"灰色文字

**状态徽章（v2.1 收敛为 3 种）**：
- 已确认（绿底）
- 待确认（琥珀底）
- 阻断（红底）

移除旧版推断/假设/未知/AI 建议/用户偏好/待决定等 8 种徽章。AI 建议与用户偏好的区分在方案比较卡片内以文字标注，不另设徽章。

三种徽章只表示确认进度，不能替代认识来源。每条关键内容仍在正文下方显示自然语言来源标签“用户明确说过 / 系统推测，待确认 / 尚未提供”；正式模式继续区分完整认识状态，但描述性实体只使用 `Fact / Inference / Assumption / Proposal`，`Unknown / Conflict / Decision` 以独立实体或关系呈现。AI 建议、用户偏好和正式决策必须以文字和数据来源分开。

#### 3.4.4 多选引用交互

**选中方式**（v2.2 移除框选，提供三种可达方式）：
1. **单击**：选中单个卡片（取消其他）
2. **Ctrl/Cmd + 点击**：桌面端追加选中（不取消其他）
3. **可见“多选”开关**：触屏和仅键盘用户进入多选模式后，用卡片内复选框追加/取消；不得把 Ctrl/Cmd 作为唯一多选方式

**选中后行为**：
- 选中卡片高亮（border + background）
- 可选卡片使用 button/checkbox 语义并声明 `aria-pressed` 或选中状态；焦点样式与选中样式可区分
- 左栏顶部出现引用条（显示所有选中卡片标题）
- 用户可在对话中描述这些卡片的关联问题（如"方案 A 会不会影响场景 1"）
- 发送消息时，前端将引用的卡片摘要以引用文本形式拼入 content 字段（不新增请求体字段，对齐 OpenAPI QuickSessionMessageRequest 的 additionalProperties: false 约束）
- 发送消息后引用条清空，选中状态保持（用户可继续操作或取消选中）

### 3.5 五步流程在分屏中的体现

快速问诊五步流程在分屏中通过"当前焦点"指示，不强制分页：

| 步骤 | 当前焦点 | 右栏高亮 | 左栏行为 |
|---|---|---|---|
| 1 输入想法 | 输入完成 | 原始想法卡片高亮 | AI 发起首批追问（`POST /messages`） |
| 2 自适应追问 | 覆盖槽位更新中 | 槽位实时变化 | AI 逐个追问，Job 轮询条展示（§3.3.4） |
| 3 理解确认 | 摘要展示 | 摘要 + 所有卡片高亮 | `POST /understanding-review`，action 为 correct/modify/uncertain/return（理解正确/修改/暂不确定/返回补充） |
| 4 方案与边界 | 方案比较 | 方案卡片高亮（高级视图） | `POST /option-preferences`，用户选偏好 |
| 5 需求简报 | 跳转到需求简报页面 | 简报视图 | `POST /briefs` 生成后**跳转到需求简报页面**（§4），非右栏切换 |

- 用户可以返回已到达步骤；尚未满足前置条件的未来步骤只允许查看说明，不能通过点击进度条绕过最低覆盖、理解确认或简报生成条件
- 顶部阶段进度条显示当前步骤；点击只改变可查看焦点，业务状态转换仍由对应命令和服务端校验决定
- 步骤切换时右栏自动滚动到对应卡片
- **首个问题数据来源**：由首次 `POST /api/quick-sessions/:id/messages`（`action=answer`）触发，返回 Job `next_question`。页面刷新或返回问诊页时统一调用 `GET /api/quick-sessions/:id/messages` 恢复 turns/current_question；不得重新发送 `POST /messages` 来重建问题

### 3.6 主题变化处理

当新输入与当前目标明显不一致时（`POST /quick-sessions/:id/messages` 的 Job 结果或服务端主题变化判定触发）：
- 对话区 AI 主动询问："这是当前想法的补充，还是一个新的需求？"
- 用户选择 `append` → 调用 `POST /api/quick-sessions/:id/topic-change`（需 `Idempotency-Key`，请求体 `action=append`），记录影响并重新评估覆盖槽位
- 用户选择 `new_session` → 调用同一端点（`action=new_session`），创建独立会话（`new_session_id`），不复制当前简报
- 用户选择 `defer` → 调用同一端点（`action=defer`），保留为待分类输入
- 调用成功后发送 `topic_change_resolved` 埋点；失败时保留用户输入，不自动合并进当前简报

### 3.7 响应式

| 宽度 | 规则 |
|---|---|
| > 1024px | 左右分屏，可拖拽分割条 |
| 769-1024px | 左右分屏，分割条固定 45%/55%，不可拖拽 |
| ≤ 768px | 单栏切换（默认显示对话，tab 切换到可视化）；底部固定 tab bar |

### 3.8 放弃、归档和删除会话

放弃、归档和删除是三个不同操作：

- **放弃会话**：顶栏操作菜单 → "放弃本次问诊"。仅当尚无简报、尚未升级且满足放弃判定时可用；点击后二次确认，调用 `POST /api/quick-sessions/:id/abandon`（需 `Idempotency-Key`），成功后状态进入 `archived`，记录 `abandoned_at`，不创建删除任务。
- **归档会话**：顶栏操作菜单 → "归档会话"。适用于用户结束使用但仍需保留查看的会话；调用 `POST /api/quick-sessions/:id/archive`（需 `Idempotency-Key`），成功后状态进入 `archived`，记录 `archived_at`。归档不等于删除，v1 不提供恢复入口。
- **删除会话**：破坏性操作，按下列流程创建删除任务并进入保留/清除流程。

**触发**：顶栏操作菜单 →"删除会话"（破坏性操作，需二次确认）。

**确认弹窗**显示（对齐 §7.3 确认弹窗规格）：
- 删除范围说明：会话本体、对话消息、覆盖槽位、简报快照一并软删除
- 提交前不自行计算物理清除时间；`estimated_purge_at` 只在 `202` 响应后展示
- 若提交后返回 `409 LEGAL_HOLD`，弹窗切换为不可删除状态并显示服务端原因；前端不得在没有预检端点时预先声称已知法律保留
- 确认按钮文字明确为"删除会话"（非"确认"），`var(--danger-700)` 主按钮

**API 调用**：`DELETE /api/quick-sessions/:id`（需 `Idempotency-Key`，对齐 PRD §10.5、ADD §9.5）。

**成功后**：
- 会话列表移除该项
- 跳转回起始页
- 显示 toast"删除任务已创建，预计于 [estimated_purge_at] 清除"，并可通过 `GET /api/delete-tasks/:id` 查看 `pending/in_progress/completed/failed/cancelled` 状态

---

## 4. 需求简报页面

> PRD ID：PRD-QUICK-002、PRD-SHARE-001

### 4.1 目的

快速问诊完成后展示版本化需求简报，支持两种视图切换、版本查看、导出、可用性反馈和升级。面向普通用户说明“用于沟通，尚未经过正式项目确认”，不要求用户理解“基线”。

### 4.2 布局

```text
┌──────────────────────────────────────────────────────────┐
│  顶栏：会话标题 / 简报版本 / 生成时间 / 状态              │
├──────────────────────────────────────────────────────────┤
│  [概述] [详细报告]                                      [导出] [升级]│
├──────────────────────────────────────────────────────────┤
│                                                          │
│  简报内容（根据所选视图渲染，数据来源 brief_version 快照）│
│                                                          │
│  - 用户原始想法                                          │
│  - 当前希望取得的结果                                    │
│  - 目标用户、相关角色和使用场景                          │
│  - 本次范围与明确不做                                    │
│  - 核心需求和优先顺序                                    │
│  - 可观察的完成条件                                      │
│  - 候选方案、取舍和推荐的验证路径                        │
│  - 约束、风险、假设和待确认问题                          │
│  - 建议下一步                                            │
│  - 可复制的沟通版本和完整详细报告正文                    │
│                                                          │
│  ┌─ 正式性说明 ────────────────────────────────────┐    │
│  │ 本简报用于沟通，尚未经过正式项目确认。             │    │
│  │ 阻断未知：2 项    非阻断未知：3 项                │    │
│  └──────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────┤
│  版本历史：v3（当前）· v2 · v1     [继续补充] [可用性反馈]│
└──────────────────────────────────────────────────────────┘
```

### 4.3 视图切换

| 视图 | 用途 | 渲染方式 | 数据来源 |
|---|---|---|---|
| 概述 | 向老师/同事/客户快速说明 | 纯文本段落，无表格，适合复制粘贴 | `GET /briefs/:version/views/simple` |
| 详细报告 | 作为完整需求分析文档，用于导出、评审和后续协作 | 结构化章节 + 表格，内容与导出正文一致 | `GET /briefs/:version/views/exec` |

- 两个视图从同一 `brief_version` 投影，不单独生成新事实
- 首次打开某视图时调用对应 GET；同一 `brief_version + view_type` 可在当前页面会话内缓存，切换回已加载视图时即时渲染；版本变化必须重新请求
- 当前视图 tab 高亮（accent 底色）

### 4.4 导出

v2.1 移除 HTML 选项，导出方式为“复制到剪贴板 / 下载文件”，采用两步流程：

**第一步 · 创建导出**：`POST /api/quick-sessions/:id/briefs/:version/exports`（需 `Idempotency-Key`），请求体指定 `view_type`（BriefViewType）+ `export_type`（copy / download），返回 `export_id` 与 `expires_at`（不返回签名下载链接，下载由第二步 GET .../download 触发）。

**第二步 · 触发下载**：`GET /api/quick-sessions/:id/briefs/:version/download`（携带 `export_id`）；需要 Markdown 或 PDF 时分别发送 `Accept: text/markdown` 或 `Accept: application/pdf`。服务端可以直接返回 `200` 文件流，也可以返回 `302` 临时 URL；临时导出 24 小时后失效。

- 导出物显示：简报版本、生成时间、阻断/非阻断未知列表，以及“用于沟通，尚未经过正式项目确认”的正式性说明
- "复制到剪贴板"直接调用前端 Clipboard API，显示 toast"已复制到剪贴板"
- 导出为 PDF 时复用 §9.5 打印规格

### 4.5 版本查看

- 简报版本列表来自 `GET /api/quick-sessions/:id/briefs`，展示版本号、生成时间、是否未完成和阻断未知数量
- 点击版本后用 `GET /api/quick-sessions/:id/briefs/:version` 只读加载；不得用当前浏览器缓存冒充完整历史
- 新生成简报成功后刷新版本列表，并高亮最新 `brief_version`
- "继续补充"按钮返回快速问诊分屏，可继续追问生成新版本（`POST /briefs` 产生新 `brief_version`）

### 4.6 简报可用性反馈

> PRD ID：PRD-USABILITY-001

底部"可用性反馈"入口（对齐 PRD §12.1 简报可用性评分指标）：

**rating 三选一**（单选按钮组）：

| 选项 | 值 | 说明 |
|---|---|---|
| 可直接使用或仅需微调 | `usable_with_minor_or_no_edits` | 简报可直接交付 |
| 需要大改 | `needs_major_revision` | 需要重大修改才能用 |
| 不可用 | `not_usable` | 简报无法使用 |

**expected_use 输入框**：可选文本输入，说明简报预期用途（如"交给开发团队排期"、"课程作业提交"）。OpenAPI 当前未声明 `maxLength`，前端不添加 500 字硬限制；产品埋点只记录是否填写等非正文属性，不复制该文本

**提交**：`POST /api/quick-sessions/:id/briefs/:version/usefulness-feedback`（需 `Idempotency-Key`），成功后显示 toast"反馈已提交"，按钮置灰不可重复提交。

### 4.7 升级正式项目

> PRD ID：PRD-UPGRADE-001、PRD-UPGRADE-002

- "升级"按钮位于右上角（accent 主按钮），需登录（游客需先认领会话或登录，见 §2.8）
- 点击后弹出确认弹窗：
  - 说明升级含义（内容按候选状态迁移，不复制确认状态）
  - 需要有效协议同意（否则 `403 AGREEMENT_REQUIRED`，引导回 §2.3 协议流程）
  - 需要确认 `brief_version`（请求体携带）
  - 升级使用幂等键，失败可安全重试

**API 调用**：`POST /api/quick-sessions/:id/upgrade`（需 `Idempotency-Key`，ADR-022）。

**成功后**：
- 原子创建正式 `projects` 记录（区别于 `quick_sessions` / `training_attempts`，对应 `ai_jobs.scope_kind='formal_project'`）+ Owner 成员 + `intake`（`source_quick_session_id`）+ 复制候选 + `upgrade_records`
- 跳转到正式项目，快速问诊记录保留只读
- 显示 toast"已升级为正式项目"

**失败处理**：
- 中途存储失败返回 `409 UPGRADE_FAILED`，可按幂等键重试且不产生重复 `upgrade_records`
- 失败时 `upgrade_records.target_project_id` 为 NULL（完全回滚，不残留半成品正式项目）

**游客状态视觉**：游客会话下升级按钮可点击（非 disabled），点击后弹出登录/认领引导弹窗（对齐 §2.8 游客会话认领流程）；按钮右上角加"需登录"角标提示（var(--accent-600) 文字，8px 圆角徽章）。

### 4.8 未完成草稿

- 若简报为带缺口的未完成草稿，顶部显示醒目警告条
- 警告条：红色边框 + 阻断未知数量 + 建议确认人
- 未完成草稿仍可导出，但导出物显著标记缺口

---

## 5. 表达训练分屏页

> PRD ID：PRD-TRAIN-001、PRD-CASE-001

### 5.0 训练案例选择页

表达训练始终先进入案例选择页。当前页面已经有案例列表、练习分屏、真实角色回答、训练回合恢复和反馈页。后续精修必须按 `08-expression-training-development-plan.md` 检查 API 字段、隐藏案例信息、训练 AgentPlan、浏览器体验和移动端布局。演示链路和真实链路的页面结构、卡片样式、筛选区和进入动作保持一致。

**案例列表**：`GET /api/training-cases` 返回可用训练案例，每项含 `id`、`name`、`category`、`difficulty_levels`、`latest_version`、`status`。

**案例分类**（按 `category` 分组展示，每组带标题）：

| 分类 | category 值 | 典型案例 |
|---|---|---|
| 软件 / 网页 | `software` | 软件项目需求澄清 |
| 学习 | `learning` | 学习计划沟通 |
| 设计 | `design` | 设计需求对齐 |
| 服务 | `service` | 服务流程梳理 |
| 困难案例 | `difficult` | 高冲突/多角色场景 |

**案例卡片**：
- 标题（`name`）+ 分类徽章 + 难度标签（`difficulty_levels`，如"简单/中等"）
- 最新版本（`latest_version`）+ 状态（仅展示 `status=active` 的案例；draft/deprecated 不进入普通用户列表）
- 点击进入难度选择 → 调用 `GET /api/training-cases/:caseId/versions/:version` 获取公开版本详情；前端只能看到场景、角色、公开练习目标和公开评价维度，不得拿到完整 `disclosure_rules`、`answer_key` 或隐藏事实
- 选中案例与版本后点击"开始训练" → `POST /api/training-attempts`（需 `Idempotency-Key`，请求体 `case_id` / `case_version` / `difficulty`），进入分屏（§5.1）

**错误**：案例不存在返回 `404 TRAINING_CASE_NOT_FOUND`，提示"案例不存在或已下线"。

### 5.1 布局

复用快速问诊的左右分屏架构，但内容不同：

- 左栏：AI 扮演角色（客户/老师/业务方）的对话
- 右栏：训练场景信息 + 提问次数 + 用户临时笔记；提交总结前不展示覆盖命中、遗漏项或分数

```text
┌──────────────────────────────────────────────────────────┐
│  顶栏：训练案例 / 角色 / 难度 / 尝试次数 / 状态           │
├────────────────────────┬─────────────────────────────────┤
│   左栏：角色对话        │   右栏：训练过程                 │
│                        │                                 │
│  AI 扮演：案例角色      │  ┌─ 案例简介 ──────────────┐    │
│  ┌────────────────┐    │  │ 你正在与案例角色沟通...   │    │
│  │ 角色: ...      │    │  └──────────────────────────┘    │
│  └────────────────┘    │                                 │
│  ┌────────────────┐    │  ┌─ 本次过程 ──────────────┐    │
│  │ 你: ...        │    │  │ 已追问 4 次              │    │
│  └────────────────┘    │  │ [我的临时笔记]           │    │
│                        │  │ 结束后查看覆盖与遗漏      │    │
│  ┌─ Job 轮询条 ─────┐  │  │ （不提前泄露评分维度）     │    │
│  │ running 处理中…   │  │  └──────────────────────────┘    │
│  └────────────────┘  │                                 │
│  [结束访谈] [提交总结]  │  ┌─ 训练提示 ──────────────┐    │
│                        │  │ 请继续用自己的问题探索   │    │
│                        │  │ 总结后再显示评价          │    │
│                        │  └──────────────────────────┘    │
└────────────────────────┴─────────────────────────────────┘
```

### 5.2 训练流程

各步骤对应 API 调用（均需 `Idempotency-Key`，触发真实 AI 的需有效协议同意，否则 `403 AGREEMENT_REQUIRED`）：

1. **选择训练案例和难度**：§5.0，角色由案例版本定义；`POST /api/training-attempts` 提交 case_id/case_version/difficulty，返回 `attempt_id`、`status=interviewing`
2. **AI 扮演角色，用户访谈追问**：每轮追问调用 `POST /api/training-attempts/:id/questions`，返回 `202` + `job_id`（Job 结果类型 `training_response`），左栏显示 Job 轮询条（§3.3.4 同款组件，复用）
3. **用户提交总结**：调用 `POST /api/training-attempts/:id/summary`；正文只用于本次处理，业务库保存摘要哈希，响应进入 `summarizing`，不能直接标记 `feedback_ready`
4. **生成反馈**：提交总结后轮询 `GET /api/training-attempts/:id`；`status=feedback_ready` 后右栏切换为反馈视图并调用 `GET /api/training-attempts/:id/feedback`
5. **用户选择重新练习或完成**：重新练习 → `POST /api/training-attempts/:id/retry`（新建后续 Attempt，保留旧反馈，不覆盖旧分数）；完成 → `POST /api/training-attempts/:id/complete`

### 5.3 反馈页面

提交总结后右栏切换为反馈视图，数据来源 `GET /api/training-attempts/:id/feedback`：

**v2.1 移除雷达图**（API 不返回维度细分分数），改为：

- **总分条形图**：`coverage_score`（0-1，如 0.72）以单条横向条形图展示，标注百分比
- **缺失维度列表**：`missing_dimensions`（如"约束与风险"、"验证"）以列表展示，每项配 AlertCircle 图标（琥珀）
- **改进建议**：`improvement_suggestions`（结构化列表）

**约束**（对齐 API §12A.6）：
- 反馈契约必须展示总分、遗漏项、建议、`dimension_breakdown` 逐维依据和 `improvement_examples` 改进示例；前端不得从自由文本建议中猜测结构化证据
- AI 反馈失败时仍展示确定性覆盖结果（总分 + 缺失维度）
- 分数只用于本次训练反馈，不宣称是权威能力认证

**底部按钮**：
- "重新练习"（ghost button）→ `POST /api/training-attempts/:id/retry`，新建 Attempt 并保留旧反馈
- "完成训练"（accent 主按钮）→ `POST /api/training-attempts/:id/complete`，进入训练结束页

### 5.4 数据隔离

- 训练数据与真实项目完全隔离
- 不产生正式 Fact/Requirement/Decision
- 训练评分不写入真实项目状态
- `training_questions` 只保存问题序号和命中规则，不保存问题正文；`training_summaries` 只保存版本与摘要哈希；当前浏览器为完成回合显示的临时正文不得写入产品埋点
- `interviewing` 期间不得展示覆盖维度命中、遗漏项、答案线索或分数；这些内容只在提交总结后的反馈页出现，避免泄露案例披露规则并污染训练测量


---

## 6. 正式项目地图工作台

当前正式项目首期主工作台采用“左侧对话 + 右侧需求地图工作台”，不再把七阶段目录作为用户主导航。旧七阶段、证据、冲突、基线、报告和变化仍是后台状态机、正式治理和后续高级能力，不应在当前页面上做成强制线性流程。

### 6.1 整体布局

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 顶栏：返回 / Requirements Clinic / 项目标题 / 当前状态 / 操作           │
├────────────────────────────┬─────────────────────────────────────────┤
│ 左侧对话                    │ 右侧需求地图工作台                      │
│ AI 当前追问                 │ 项目核心                                │
│ 用户回答输入框              │ 模块节点（数量可变）                    │
│ 引用的地图节点 token        │ 当前节点详情                            │
│ 等待与错误反馈              │ 候选方案 / 待确认项 / 报告投影          │
│ 历史问答                    │ 节点引用菜单                            │
└──────────────────────────────────────────────────────────────────────┘
```

**布局约束**：
- 左侧对话始终保留，不随地图节点切换消失。
- 右侧地图必须支持不同主题生成不同数量节点，节点可分组、折叠和滚动。
- 节点引用交互沿用快速问诊输入框 token 模式，但文案改为自然的“加入对话”或等价表达。
- 移动端使用“对话 / 地图”切换，不把地图压缩成不可读的长页。
- 旧三栏/七阶段规范只作为后续正式治理能力参考，不作为当前首期 UI 主导航。

### 6.2 左栏：阶段导航

本小节以下旧阶段导航内容保留为后续完整正式项目治理的候选信息架构。当前首期正式项目页面不展示左侧七阶段导航；用户主路径以左侧对话和右侧需求地图为准。

#### 阶段列表

七阶段进度导航，对齐 PRD §6.2 与 ADD §11.3。七阶段是 `[H]` 信息架构，不是只进不退的瀑布。用户可以查看已到达阶段；查看未来阶段不等于推进业务状态，未满足前置条件时操作保持锁定并显示原因：

| 阶段 | 标题 | 类型 |
|---|---|---|
| 1 | 建档 | 普通 |
| 2 | 访谈 | 普通 |
| 3 | 目标确认 | 关口一 |
| 4 | 冲突与决策 | 关口二 |
| 5 | 范围确认 | 关口三 |
| 6 | 分析报告 | 普通 |
| 7 | 变更预演 | 普通 |

每阶段行显示：
- 阶段编号（等宽字体 `var(--font-mono)` 13px）
- 标题（14px semibold）
- 状态徽章（未开始/进行中/已完成/阻断）

**状态视觉**：
- 未开始：`var(--slate-600)` 文字 + 空心圆
- 进行中：`var(--accent-600)` 文字 + `Loader` 旋转图标（`var(--accent-500)`）
- 已完成：`var(--success-700)` 文字 + `CheckCircle` 图标
- 阻断：`var(--danger-700)` 文字 + `XCircle` 图标

**当前阶段**：行背景 `var(--bg-selected)`，左边框 3px `var(--accent-600)`，文字 `var(--text-primary)`

**关口阶段**：标题右侧显示关口图标（`ShieldCheck` 18px，`var(--warning-700)`），提示该阶段需人工确认

**已完成阶段**：标题左侧显示绿色勾选（`CheckCircle` 16px，`var(--success-700)`）

#### 底部信息块

左栏底部固定显示：

- **项目成员**：首字母头像列表（28px 圆形，`var(--accent-100)` 底 + `var(--accent-700)` 文字），hover 显示角色标签与权限；数据来源 `GET /api/projects/:id/members`
- **冲突状态摘要**：`盾牌图标 N 项未决`，`N > 0` 时 `var(--warning-700)`；阻断冲突显示 `var(--danger-700)`；数据来源 `GET /api/projects/:id/conflicts?status=open`
- **待确认事项计数**：`信封图标 N 项`，`N > 0` 时 `var(--accent-600)` 加角标；使用契约已有的 `status=pending` 查询 Outcomes/Drivers，并与 `GET /api/projects/:id/conflicts?status=open` 聚合；不得发送 OpenAPI 未声明的 `review_status` 参数


### 6.3 中栏：分析结果主面板

> PRD ID：PRD-FLOW-001

根据当前阶段显示不同内容。所有卡片遵循 §1.5 规格（padding 16px、radius 8px、border 1px solid var(--border-default)、background var(--bg-surface)）。下列“数据来源 API / 用户操作触发 API”是实现规格；仅开发/测试模式可在调试抽屉查看，正式用户页面不显示路径、operationId 或数据库表名。

#### 建档阶段

> PRD ID：PRD-INTAKE-001、PRD-RISK-001

**数据来源 API**：
- `GET /api/projects/:id` — 项目信息（标题、建档人、建档时间、状态、DomainProfile ID/版本）
- `GET /api/projects/:id/sources` — 已上传材料列表
- `GET /api/projects/:id/domain-profile` — 当前领域画像候选（含 candidate 标记）
- `GET /api/agreements/consents` — 协议同意状态行（取代 ADD v1.4 已删除的「出站策略」行）

**用户操作触发 API**：
- `POST /api/projects/:id/sources`（`multipart/form-data`，单文件 ≤ 25MB，支持多文件并发上传）— 上传材料
- `POST /api/projects/:id/analysis-runs` 且 `task=domain_profile`（返回 `202 Accepted` + `job_id`，进入 §7.8 Job 轮询）— 生成领域画像候选
- `POST /api/projects/:id/domain-profile/reviews`（`action=accept|modify|reject|uncertain`，需 `Idempotency-Key`；请求体使用统一 `ReviewActionRequest`）— 评审领域画像
- `POST /api/projects/:id/intakes` — 追加修订原始输入（保留旧版本，不覆盖）

**中栏内容**：

- **原始输入卡**：不可变，显示用户原始文本（保留换行），左上角 `锁定` 图标 + "原始输入（不可变）" 标签，背景 `var(--bg-subtle)`；卡片底部显示「追加修订」入口（触发 `POST /api/projects/:id/intakes`）
- **项目启动信息表**：建档人、建档时间、输入数量、材料数量、协议同意状态（表格行高 44px）
- **材料上传区**（`GET /api/projects/:id/sources` 返回项）：
  - 顶部「上传材料」按钮（accent 主按钮），点击展开拖拽区 + 文件选择器，提交 `multipart/form-data`
  - 每行 = 文件名 + 类型徽章 + `sensitivity`（public/internal/confidential/restricted，显示为公开/内部/机密/严格限制）+ `extraction_status`（uploaded/queued/parsing/parsed/failed，parsing 时显示 spinner）+ `byte_size`（自动换算 KB/MB）+ 上传时间 + 来源标签
- **系统初步候选**（均标记"候选/待确认"徽章，`var(--warning-100)` 底 + `var(--warning-700)` 文字）：
  - 时间期望
  - 风险提示
  - 领域画像（DomainProfile 候选）：候选 ID、生成版本、`task=domain_profile` Job 状态（queued/running/succeeded），succeeded 后展示画像正文与建议反事实问题；提供「重新生成」按钮（重新触发 `POST /api/projects/:id/analysis-runs` 且 `task=domain_profile`）
  - 画像底部「评审」操作区：accept=接受画像 / modify=修改画像候选 / reject=驳回并要求重新生成 / uncertain=暂不确定并创建待核实事项（触发 `POST /api/projects/:id/domain-profile/reviews`）
- **"当前尚不知道"列表**：未知项清单，每项标阻断/非阻断
- **三个人工关口预览**：关口一/二/三名称 + "待该阶段确认"状态；明确映射 关口一=outcome（目标确认）/ 关口二=evidence_conflict（证据冲突与决策）/ 关口三=scope（范围确认）

阶段 1 不生成正式利益相关者、As-Is、约束、目标、指标、失败条件和范围（对齐 PRD §6.3 阶段 1）。


#### 访谈阶段

**数据来源 API**：
- `GET /api/projects/:id/outcomes` — 已浮现的 Outcome 列表；其证据关联通过返回的稳定 ID 和证据详情回查，不把 Outcome 冒充为证据条目
- `GET /api/projects/:id/requirements` — 已浮现的需求列表
- `GET /api/evidence/:evidenceId` — 单条证据详情（含原文片段与抽取元数据）

**用户操作触发 API**：
- `POST /api/projects/:id/analysis-runs` 且 `task=structured_extraction`（返回 `202 + job_id`，进入 §7.8 Job 轮询）— 触发结构化提取，将材料原文转为可定位证据
- `GET /api/evidence/:evidenceId` — 用户点击证据来源链接时拉取详情（侧拉抽屉展示）

**中栏内容**：

- **演示角色选择器**：从 Aster Fixture 读取角色和固定访谈消息，chip 可多选筛选；“全部”默认选中
- **真实访谈流**：通过 `GET /api/projects/:id/interview-turns` 恢复正式访谈记录，通过 `GET /api/projects/:id/stakeholders` 恢复角色筛选；该流不同于快速问诊 `quick_turns`
- **「触发结构化提取」按钮**：顶部操作区，点击调用 `POST /api/projects/:id/analysis-runs` 且 `task=structured_extraction`，进入 §7.8 Job 轮询
- **Fixture 对话流**：结构化呈现，每条消息含：
  - 角色标签 + 时间（12px，`var(--text-tertiary)`）
  - 内容（结构化段落 + 列表 + 表格）
  - 证据来源链接（每条底部，格式「基于材料 [source_name]」而非「第 N 段」，等宽字体小字；点击触发 `GET /api/evidence/:evidenceId` 展开侧拉抽屉）
  - 认识状态徽章（`EpistemicBadge` 只展示描述性实体返回值：Fact / Inference / Assumption / Proposal；Unknown / Conflict / Decision 作为独立实体卡片或关系展示，不把 Requirement provenance 混入该枚举）
- **右侧证据与判断栏**：可折叠到右栏（折叠后右栏显示证据数量角标）

正式事实必须定位到来源；演示链路使用 Fixture 的 `evidence_id/source_id/span`，真实链路通过 `GET /api/projects/:id/evidence-links` 和 `GET /api/projects/:id/trace-links` 从实体跳转证据，不能把 Outcome ID 当 Evidence ID。新角色、目标缺口或冲突可重开相关任务（对齐 PRD §6.3 阶段 2）。


#### 目标确认阶段（关口一 = outcome）

> PRD ID：PRD-GATE-001

**数据来源 API**：
- `GET /api/projects/:id/drivers` — Driver 列表（响应 `version` 作为后续命令的 `expected_version`）
- `GET /api/projects/:id/outcomes` — Outcome 列表（含状态、责任人、复核结论）

**用户操作触发 API**：
- `POST /api/projects/:id/drivers` — 创建 Driver
- `PATCH /api/drivers/:driverId`（请求体含 `expected_version`）— 修改 Driver；并发冲突时返回 `409 VERSION_CONFLICT`，前端重新拉取后提示用户合并
- `PATCH /api/outcomes/:outcomeId` — 修改 Outcome
- `POST /api/outcomes/:outcomeId/reviews`（请求体使用统一 `ReviewActionRequest`：`action` + `entity_version` + `reason`，`modify` 时含 `after_value`，`uncertain` 时含 `follow_up`）— 类型化评审
- `POST /api/projects/:id/gates/outcome/reviews`（关口评审，请求体 `action=accept/modify/reject/uncertain` + `entity_version` + `reason` + `follow_up`）

**中栏内容**：

- **目标阶梯（Outcome Ladder）可视化**：请求 → Job → Outcome → Capability 四级，每级为卡片，箭头连接
- 每个目标卡片显示：
  - 编号（等宽字体）
  - 标题（16px semibold）
  - 状态徽章（已确认/待确认/暂不确定）
  - 责任人（首字母头像 + 名字）
  - 当前 `version` 角标（等宽字体 11px，`var(--text-tertiary)`），提交修改时映射为请求 `expected_version`
- **Pro 高风险复核结果**（如有）：折叠卡，显示复核结论与建议反事实问题
- **关口动作按钮**（底部固定，四按钮均真实可用，对齐 PRD §6.4）：
  - "确认无误"（`action=accept`，`var(--accent-600)` 主按钮）
  - "需要修改"（`action=modify`，ghost button，需提交 `after_value`，创建新版本并使受影响的后续确认失效）
  - "驳回"（`action=reject`，ghost button + `var(--danger-700)` 文字）
  - "暂不确定"（`action=uncertain`，ghost button，需提交 `follow_up` 创建待核实任务）
- **四按钮 action 绑定**：均调用 `POST /api/projects/:id/gates/outcome/reviews`，`action` 取 `accept/modify/reject/uncertain`。按 OpenAPI，四类动作都必须填写可审计 `reason`；modify 额外要求有效 `after_value`，uncertain 额外要求完整 `follow_up`。重复提交或阻断返回 `409`

修改、驳回与暂不确认创建新版本/待办并使受影响的后续确认失效（对齐 PRD §6.4）。AI 不能执行此关口。


#### 冲突与决策阶段（关口二 = evidence_conflict）

> PRD ID：PRD-GATE-001

**数据来源 API**：
- `GET /api/projects/:id/conflicts` — 冲突摘要列表，仅保证 `id`、`statement`、`severity`、`status`、`version` 等 OpenAPI 字段；API v1.2 尚无双方观点和候选方案读取契约

**用户操作触发 API**：
- `POST /api/conflicts/:conflictId/resolve`（请求体为 `decision{question,selected_option_id,rationale,review_trigger?}` + `owner_id`，可含 scope/expiry；需 `Idempotency-Key`）— 冲突解决
- `POST /api/projects/:id/gates/evidence_conflict/reviews`（关口评审，请求体 `action=accept/modify/reject/uncertain` + `entity_version` + `reason` + `follow_up`）

**中栏内容**：

- **冲突摘要卡片**：显示 statement、severity、status、version；不凭 Fixture 字段扩展生产响应
- **演示方案比较表**：Aster Fixture 可展示双方观点、证据引用和候选方案，所有方案均可选；固定标记为演示数据
- **真实方案比较表**：进入冲突详情时调用 `GET /api/conflicts/:conflictId`，从 `sides/options/current_decision_id` 渲染双方观点、候选方案和当前决策
- **所选方案和决策理由**：选中方案高亮并构造 `decision` 对象提交 `POST /api/conflicts/:conflictId/resolve`
- **事实/推断/假设/未知处理摘要**：四类计数 + 阻断项列表
- **关口动作按钮**：同关口一四按钮模式

阻断冲突未处理时不能进入已确认范围（对齐 PRD §6.4）。


#### 范围确认阶段（关口三 = scope）

> PRD ID：PRD-SCOPE-001

**数据来源 API**：
- `GET /api/projects/:id/requirements` — 分页读取需求后按响应中的 `horizon` 与 `scope_disposition` 在客户端分组；OpenAPI v1.2 未声明这两个查询参数，不得把 UI 过滤条件直接拼到请求中
- `GET /api/projects/:id` — 当前 `current_baseline` 摘要
- `GET /api/projects/:id/baselines` — 基线版本历史列表

**用户操作触发 API**：
- `PATCH /api/requirements/:requirementId`（请求体含 `horizon` 与 `expected_version`）— 拖拽触发，更新需求所属列
- `POST /api/projects/:id/baselines`（需 `Idempotency-Key`）— 创建基线
- `POST /api/baselines/:baselineId/approve`（需 `Idempotency-Key`）— 批准基线
- `POST /api/projects/:id/gates/scope/reviews`（关口评审，请求体 `action=accept/modify/reject/uncertain` + `entity_version` + `reason` + `follow_up`）

**中栏内容**：

- **As-Is 单独展示**：独立卡片块，不与 Now/Next 混排
- **Now / Next / Later / Watch 四列看板**：每列可拖拽卡片调整归属；拖拽放下时触发 `PATCH /api/requirements/:requirementId` 更新 `horizon` 字段，请求体携带 `expected_version` 防并发覆盖；版本冲突时回滚拖拽并提示
- 每张卡同时提供“移动到…”菜单，供触屏、键盘和辅助技术用户完成同一操作；拖拽不是唯一交互
- **"明确不做"作为独立范围处置**：单独第五列，红色边框 `var(--danger-700)`，对应 `scope_disposition=excluded`
- 每张需求卡显示：
  - ID（等宽字体 12px）+ provenance 来源标签
  - Driver / Decision 依据通过 `GET /api/projects/:id/evidence-links` 与 `GET /api/projects/:id/trace-links` 显示；响应缺失时展示“证据关系不可用”，不生成假链接
  - 时间归属 + 生命周期状态（candidate/supported/reviewed/...）
  - 优先级 + 责任人；验收条件通过 `GET /api/requirements/:id/acceptance-criteria` 独立读取
  - 当前 `version` 角标，PATCH 时作为 `expected_version`
- **基线操作区**：底部“创建基线”按钮调用 `POST /api/projects/:id/baselines`，成功后刷新 `GET /api/projects/:id/baselines` 并展示当前基线摘要；approved 基线触发关口三完成
- **关口动作按钮**：同四按钮模式

Now/Next/Later/Watch 表示时间和投资意图，"不做"是范围处置（对齐 PRD §6.3 阶段 5）。


#### 分析报告阶段（异步 Job 流程）

> PRD ID：PRD-REPORT-001

**数据来源 API**：
- `GET /api/projects/:id` — 当前报告摘要（若存在）
- `GET /api/projects/:id/reports` — 报告版本历史列表
- `GET /api/reports/:reportId` — 按路由已知 ID 获取报告元数据（报告号、版本、数据指纹、模板、DomainProfile ID/版本、生成时间、状态、`chapter_coverage`、`gate_defects`）
- `GET /api/ai-jobs/:jobId` — 编译 Job 状态（`progress`、`current_step`、`last_error_code`；不保证章节级字段）

**用户操作触发 API**：
- `POST /api/projects/:id/reports`（返回 `202 Accepted` + `job_id`，需 `Idempotency-Key`）— 触发报告编译，进入异步 Job 流程
- `POST /api/reports/:reportId/releases`（需 `Idempotency-Key`，请求体 `expected_version` 使用当前 `report_version`）— 发布门禁，全部 G0-G6 通过后方可发布
- `GET /api/projects/:id/reports/:reportId/download`（返回 `200 application/pdf` 或 `302` 临时签名 URL，重定向 URL 24 小时有效）— 下载 PDF（`GET /api/reports/:reportId/file` 不作为项目页面首选入口）

**异步 Job 流程**（取代旧版 `window.print()` 方案）：

1. **触发编译**：用户点击「编译报告」按钮 → `POST /api/projects/:id/reports` 返回 `202 Accepted` + `job_id`
2. **轮询进度**：前端按 §7.8 轮询 `GET /api/ai-jobs/:jobId`，只显示契约提供的 `progress` 与 `current_step`；不得自行推算剩余时间或固定为 N/12。若 `current_step` 提供章节名可原样展示；失败或 `manual_review` 按可恢复性显示下一步
3. **查询元数据**：Job 成功后 `GET /api/reports/:reportId` 拉取报告元数据
4. **发布门禁**：用户点击“发布”→ `POST /api/reports/:reportId/releases`；任一门禁未通过返回 `409 BLOCKING_CONFLICT`。页面按类型化 `gate_defects` 显示 G0-G6、严重度、阻断状态、缺陷说明和处理建议；若响应不符合 Schema，只展示错误 message/request_id 并保持发布失败
5. **下载 PDF**：发布成功后“下载 PDF”按钮可用；下载端点可以返回 `200 application/pdf` 文件流或 `302` 临时签名 URL（24 小时有效），两种响应均需处理

**中栏内容**：

- **受众选择**：Aster 演示 Fixture 可以展示五个预生成投影（管理层 / 产品业务 / 架构 / 研发测试 / 合规运营）；真实链路的每个 ReportSnapshot 只有一个 `audience`
  - 编译前用选择器设置 `CompileReportRequest.audience`；编译后显示当前受众，不把切换 tab 伪装为同一快照的即时投影
  - 改变受众需要用户明确触发新的编译命令并生成新报告快照；报告历史 tab 读取 `GET /api/projects/:id/reports`
- **门禁栏**（右侧或下方）：G0-G6 七道门禁（对齐 ADD §13.1），每个门禁显示状态（通过=绿/失败=红/未运行=灰），失败门禁可展开查看失败原因与 `gate_code`
  - G0 领域适配 / G1 证据 / G2 认识状态 / G3 Driver / G4 交付 / G5 变化 / G6 报告（对齐 ADD §13.1）
  - `chapter_coverage` 按模板章节或内容块 ID 展示覆盖状态；`gate_defects` 按 G0-G6 展示严重度、阻断状态、说明和处理建议。演示链路使用 Aster Fixture，真实链路直接消费 OpenAPI 的类型化结构
- **元数据**（顶部右侧）：
  - 报告号、版本、数据指纹
  - 模板、DomainProfile ID/版本
  - 生成时间、状态（draft/gate_failed/rendering/staged/ready/released/publish_failed/superseded，对齐 API §10.7）
- **编译进度区**：编译中显示 §7.8 Job 轮询条 + 服务端 `current_step`；Aster Fixture 可以显示 12 章进度，通用报告按模板实际 8–15 章，不硬编码 12

报告不新增事实，数字/状态/引用全部回查（对齐 ADD §13.1 G6）。打印需求改由后端生成的 PDF 承载，前端不再调用 `window.print()`；§9.5 打印规格仅作为浏览器原生打印兜底（如离线场景）。


#### 变更预演阶段

> PRD ID：PRD-CHANGE-001

**数据来源 API**：
- `GET /api/change-previews/:previewId/impact` — 影响列表（受影响的实体与动作）
- 真实变化历史来自 `GET /api/projects/:id/changes`；页面可展示完整历史、当前路由变化及其影响。预演不进入真实变化列表

**用户操作触发 API**：
- `POST /api/projects/:id/change-previews`（返回 `201` + ChangePreview，不返回 `job_id`）— 创建只读变化预演
- `POST /api/projects/:id/changes` — 登记真实变化
- `GET /api/changes/:changeId/impact` — 查看单条变化影响
- `POST /api/changes/:changeId/confirm`（需 `Idempotency-Key`）— 确认变化
- `POST /api/changes/:changeId/withdraw`（需 `Idempotency-Key`）— 撤回变化

**中栏内容**：

- **变更横幅**：变更描述 + 触发原因（顶部，`var(--warning-100)` 底）
- **影响传播图**：使用 React Flow 实现
  - 节点 = 实体（证据/目标/需求/决策/验收/报告）
  - 边 = 影响关系
  - 节点用文字标签 + 形状/图标区分实体类型，颜色只作辅助
  - 数据来源 `GET /api/change-previews/:previewId/impact`
- **影响行列表**：表格，每行 = 实体类型 + 实体 ID + impact_type + severity + recommended_action + required_stage + rationale + status（对齐 API §11.2 变化预演响应）；另显示顶层 unresolved_items（未解决项列表）与 suggested_stages（建议阶段）
- **预演动作**：关闭预演 / 以此内容登记真实变化。只有用户另行调用 `POST /api/projects/:id/changes` 创建真实 Change 后，真实变化详情页才显示“确认 / 撤回”，分别调用 `POST /api/changes/:changeId/confirm` 与 `POST /api/changes/:changeId/withdraw`

变更预演是只读场景视图，不是项目状态；预演结束仍为 Released（对齐 ADD §12.2）。


### 6.4 右栏：AI 追问与跟进面板

对齐 ADD §6.4 `FollowupPanel` 组件。

- **默认折叠**为右侧 48px 细条，显示未读数角标 + 当前问题摘要（旋转 90° 文字）
- **点击展开**为 320px 栏，背景 `var(--bg-surface)`，左边框 `1px solid var(--border-default)`
- 展开动画 200ms ease-out（width + opacity）

**展开后内容**（自上而下）：

1. **当前问题**（AI 追问）：
   - 头像：首字母圆形头像（28px）+ "需求问诊室"角色标签
   - 问题正文（结构化呈现）
   - 认识状态标签（针对哪类缺口）
2. **用户回答输入框**：
   - textarea，placeholder "回答 AI 的追问..."
   - Enter 发送，Shift+Enter 换行
   - 发送按钮（accent 色）
3. **AI 归纳**（结构化呈现）：
   - 段落 + 列表
   - 更新标记（"已更新：目标 N"）
4. **证据来源链接**：每条对话底部显示来源名称与可定位片段；点击后通过稳定 Evidence ID 回查，不使用脱离材料版本的“第 N 段”作为唯一定位
5. **跟进建议按钮**：2-3 个 ghost button（border 1px solid var(--border-default)），点击填入输入框

**风格约束**：
- 专业企业访谈工具风格，不用卡通角色立绘和彩色气泡（对齐 ADD §6.1）
- 角色表示：首字母头像 + 角色标签
- 对话内容结构化，证据来源链接放每条对话底部

### 6.5 正式项目状态机

对齐 ADD §12.2 与 DB v1.2 状态枚举：

```text
Draft → Ingesting → Eliciting → Reviewing → Baselined → Reporting → Released → Changing → Reviewing
                                                     │                    │           │
                                                     └────────────→ Archived ←───────┘
```

状态枚举（对齐 DB `projects.status`）：Draft / Ingesting / Eliciting / Reviewing / Baselined / Reporting / Released / Changing / Archived

状态与阶段的关系：
- `Draft` / `Ingesting` 对应阶段 1 建档
- `Eliciting` 对应阶段 2 访谈
- `Reviewing` 对应阶段 3-5（三关口确认期间）
- `Baselined` 对应阶段 5 完成（范围基线确认）
- `Reporting` 对应阶段 6 分析报告
- `Released` 对应阶段 6 发布完成
- `Changing` / `Reviewing` 对应阶段 7 变更预演/变化处理
- `Archived` 默认只读（项目归档，可由 Released 或 Changing 转入）；API v1.2 未定义恢复命令，因此 v1 不显示恢复操作，但不把“永远不可恢复”升级为架构不变量

新增转换箭头（对齐 DB v1.2 归档修正）：
- `Released → Archived`：已发布项目归档（不再维护）
- `Changing → Archived`：变化处理后归档

约束：
- DomainProfile 候选、审核和专业包激活发生在 Draft 内，不额外制造与业务阶段竞争的项目状态
- 只有人工确认可以从 Reviewing 进入 Baselined
- 存在 Blocking Conflict 时禁止进入 Baselined
- Released 后变化必须产生新版本
- 变更预演是只读场景视图，不是项目状态
- **重开阶段不创建第二个项目**：影响判断后返回必要阶段重开，状态机回退到对应状态，不新建项目
- 状态转换在左栏阶段导航中体现（阶段状态徽章随项目状态变化）
- Archived 在 v1 界面中只读且没有恢复入口；未来如需恢复，必须先补上游状态转换、授权和审计契约


### 6.6 响应式

| 宽度 | 规则 |
|---|---|
| > 1120px | 三栏完整（左 240px + 中 flex + 右 320px） |
| 821-1120px | 左栏收窄至 200px，右栏折叠为 48px 细条 |
| ≤ 820px | 单栏，阶段改顶部水平进度条，右栏改为底部抽屉 |

---

## 7. 全局交互组件

> PRD ID：PRD-ACTION-001

### 7.1 全局导航与离开保护

- 所有业务页固定提供产品首页、当前会话/项目标题和返回入口；不以浏览器后退作为唯一导航方式
- 存在未提交输入、正在编辑的修改或尚未确认的破坏性操作时，返回/关闭页面先说明影响；用户取消后留在当前页
- 正在运行的服务端 Job 不因离开页面自动取消；返回时按 Job ID 恢复轮询。仅用户主动取消且端点允许时调用 `POST /api/ai-jobs/:id/cancel`
- 演示链路本地草稿离开前写入 DraftStore；Fixture 进度按场景版本恢复，损坏时明确提示并允许清除
- v1 不实现 Cmd/Ctrl+K 命令面板。该能力没有上游产品需求，且会扩大导航、搜索、权限和快捷键测试面；如后续需要，先新增 PRD ID

### 7.2 Toast 通知

- 右上角显示，距顶 `var(--space-4)`，距右 `var(--space-4)`
- 宽 360px，radius 8px，阴影 `var(--shadow-2)`
- 自动消失：成功 3s、普通信息 5s；包含操作、错误或警告的通知默认保持到用户关闭或完成动作
- 鼠标悬停暂停消失

**类型视觉**（统一中性边框 + 状态图标 + 文字，不使用装饰性彩色左边框）：

| 类型 | 图标 | 背景 |
|---|---|---|
| 成功 | `CheckCircle`（绿） | `var(--success-100)` |
| 警告 | `AlertTriangle`（琥珀） | `var(--warning-100)` |
| 错误 | `XCircle`（红） | `var(--danger-100)` |
| 信息 | `Info`（蓝） | `var(--info-100)` |

- 支持操作按钮（如"重试"、"查看详情"），ghost button 样式
- 入场动画 200ms ease-out（translateX 16px → 0 + opacity）
- `aria-live="polite"`，错误类 `aria-live="assertive"`
- 右上角关闭图标视觉为 16px，点击/触控命中区至少 32×32px（移动端 44×44px），`aria-label="关闭通知"`，点击立即消失

### 7.3 确认弹窗

- 居中模态，宽 480px，radius 8px，背景 `var(--bg-surface)`，阴影 `var(--shadow-overlay)`
- 背景遮罩 `rgba(15,23,42,0.5)` + `backdrop-filter: blur(4px)`
- 用于破坏性操作（删除、覆盖、撤回）

**结构**：
- 标题（16px semibold）+ 描述（14px regular，`var(--text-secondary)`）
- 取消按钮（ghost）+ 确认按钮（`var(--danger-700)` 主按钮，破坏性操作）
- 确认按钮文字明确动作（如"删除需求"而非"确认"）

**交互**：
- `Esc` 关闭（等同取消）
- 背景遮罩 `inert`（不可点击穿透）
- 焦点圈闭在弹窗内，关闭后返回触发按钮
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` 指向标题

### 7.4 骨架屏

- 列表骨架：灰色矩形行（高 44px，背景 `var(--slate-200)`，radius 4px）
- 卡片骨架：灰色矩形块（高 120px，radius 8px）
- 详情骨架：标题行（宽 60%）+ 段落行（3 行，宽 100%/90%/70%）
- shimmer 动画 1.5s linear infinite（`background-position` 渐变扫过）
- `prefers-reduced-motion: reduce` 时显示静态灰色块

### 7.5 空状态

有助于下一步时才显示结构化空状态；“暂无冲突”等正常结果可使用简短文本，不为填满页面添加无意义插图或按钮。结构：
- 图标（32px，`var(--slate-400)`）
- 标题（16px semibold，`var(--text-secondary)`）
- 引导文案（13px regular，`var(--text-tertiary)`）
- 行动按钮（ghost 或 accent，视场景）

示例：
- "还没有证据 — 上传材料开始收集"
- "暂无冲突 — 继续访谈可能浮现分歧"
- "尚无决策 — 进入冲突与决策阶段后记录"

### 7.6 错误状态

- 不显示原始错误信息（堆栈、状态码等技术细节）
- 友好提示（图标 + 标题 + 描述）+ 重试按钮
- 分别处理：
  - 网络错误："网络连接中断，请检查后重试"
  - 权限错误："你没有执行此操作的权限"
  - 协议未同意："需先同意服务与数据处理协议"
  - 应用限流 `429 RATE_LIMITED`："操作太频繁，请稍后再试"，如响应含 `retry_after_seconds` 则显示可重试时间
  - 项目任务繁忙 `429 MODEL_BUSY`："当前项目已有多个分析任务在运行，请稍后再试或取消不需要的任务"
  - 全局队列已满 `429 QUEUE_FULL`："当前排队任务较多，稍后重试"
  - 模型服务不可用 `503 MODEL_UNAVAILABLE`："AI 服务暂时不可用，已保留你的输入，请稍后重试"
- 业务错误：按业务语义提示（如"阻断冲突未处理，无法进入基线"）
- 可复制的 `request_id`（如响应提供），用于支持排障；不展示堆栈、内部路径或 Prompt
- 错误卡片背景 `var(--danger-100)`，图标 `XCircle`（`var(--danger-700)`）

### 7.7 加载状态

| 时长 | 显示 |
|---|---|
| < 500ms | 不显示 loading |
| 500ms-2s | 显示骨架屏 |
| > 2s | 显示服务端提供的百分比或步骤文案；没有进度契约时只显示等待说明，不伪造百分比 |

- AI 命令显示"正在分析..."文案，不显示 spinner（避免暗示即时完成）
- 长任务显示步骤进度（如"提取证据 3/8..."）

### 7.8 Job 轮询组件

> PRD ID：PRD-TASK-001

覆盖 API §2.4 全部 8 个 AI 写命令的 `202 Accepted` + `job_id` 异步响应与状态机。8 个命令：
1. 项目候选生成（`POST /api/projects` → `project_candidates`）
2. 分析运行（`POST /api/projects/:id/analysis-runs` → `analysis_result`，覆盖结构化提取、领域画像生成、冲突分析等子任务）
3. 报告编译（`POST /api/projects/:id/reports` → `report_snapshot`）
4. 快速问诊追问（`POST /api/quick-sessions/:id/messages` action=answer → `next_question`）
5. 理解确认（`POST /api/quick-sessions/:id/understanding-review` → `understanding_updated`）
6. 方案偏好记录（`POST /api/quick-sessions/:id/option-preferences` → `option_comparison`）
7. 简报生成（`POST /api/quick-sessions/:id/briefs` → `brief_version`）
8. 训练追问（`POST /api/training-attempts/:id/questions` → `training_response`）

**触发**：用户操作触发任一 AI 写命令后，前端收到 `202 Accepted` + `job_id`，在操作区下方显示 Job 轮询条。

**Job 状态机**（对齐 API §2.4）：

| 状态 | 含义 | 视觉 |
|---|---|---|
| `queued` | 排队中 | 蓝色 spinner + "排队中…" |
| `running` | 执行中 | 青色 spinner + 进度文案 |
| `validating` | 结果校验中 | 深蓝色 spinner + "校验中…" 文案 |
| `retry_wait` | 等待重试 | 琥珀色 AlertTriangle + 服务端 `current_step`；当前契约无 `retry_at`，不显示虚构倒计时 |
| `manual_review` | 需人工复核 | 玫红色警告图标 + 复核入口 |
| `succeeded` | 成功 | 绿色勾选 + 1.5s 后自动淡出 |
| `failed` | 失败 | 红色叉 + "重试"按钮 |
| `cancelled` | 已取消 | 灰色 + "已取消" |

**轮询规则**：
- 轮询端点：`GET /api/ai-jobs/:jobId`
- 初始间隔 2s，指数退避至最大 30s（2 → 4 → 8 → 16 → 30 → 30…），最长 10 分钟（对齐 API §2.4 与 §8.2）
- `running` / `validating` 状态显示当前步骤进度（如「提取证据 3/8」），来源 `job.progress` 字段
- 终态（`succeeded` / `failed` / `cancelled` / `manual_review`）后停止轮询
- 页面不可见时（`document.hidden`）暂停轮询，可见时立即拉取一次后继续
- 网络错误时重试拉取（最多 3 次），超过后显示「连接中断，点击重试」

**视觉规格**：
- 轮询条高 40px，背景 `var(--bg-surface)`，边框 `1px solid var(--border-default)`，radius 6px
- 左侧圆点 + 状态图标（24px）+ 状态文案（13px）+ 步骤进度（12px，`var(--text-tertiary)`）
- 右侧操作：`retry_wait` 显示等待说明；`failed` 仅在原命令允许重新执行时显示“重新执行”；`manual_review` 显示“查看需人工处理原因”，没有专用复核路由时不显示失效链接
- `queued/running/retry_wait` 且调用者有权限时显示“取消任务”，收集简短 `reason` 后以 `Idempotency-Key` 调用 `POST /api/ai-jobs/:id/cancel`；点击后立即禁用按钮，并按响应进入 `cancelled` 或显示不可取消原因
- 成功后 1.5s 自动淡出消失

**并发与幂等**：
- 同一用户操作触发的 Job 在轮询条内唯一展示，不重复创建
- 网络失败后重发同一次业务命令必须复用原 `Idempotency-Key`，以取回同一 `job_id`；终态失败后用户明确“重新执行”才生成新 Key 和新 Job
- `cancelled` 状态下提供「重新触发」入口

### 7.9 删除确认组件

> PRD ID：PRD-RETENTION-001

覆盖 `DELETE /api/projects/:id` 与 `DELETE /api/quick-sessions/:id` 两个破坏性端点（DB v1.2 `delete_tasks` 支持游客删除）。

**触发**：项目列表「删除项目」、快速问诊顶栏「删除会话」（破坏性操作，需二次确认）。

**确认弹窗**显示（基于 §7.3 确认弹窗规格增强）：
- 标题：删除对象名称 + "删除确认"
- 删除范围说明：列出将被软删除的关联数据
  - 项目删除：项目本体、材料、证据、需求、冲突、决策、基线、报告、变更记录
  - 快速问诊删除：会话本体、对话消息、覆盖槽位、简报快照
- 提交前不自行计算 `estimated_purge_at`；`202` 后按响应显示“预计清除时间”
- `409 LEGAL_HOLD` 只能在提交后得知；收到后切换为法律保留视图，禁用再次提交并显示服务端原因
- 确认按钮文字：「删除项目」/「删除会话」（明确动作，非"确认"），`var(--danger-700)` 主按钮

**调用流程**：
1. 用户点击「删除」→ 显示确认弹窗
2. 用户确认 → `DELETE /api/projects/:id`（或 `DELETE /api/quick-sessions/:id`），请求头携带 `Idempotency-Key`（UUID v4）
3. 成功（`202`）：返回 `delete_task_id` 和 `estimated_purge_at`，弹窗显示“删除任务已创建”；用 `GET /api/delete-tasks/:id` 查询实际状态
4. 法律保留（`409 LEGAL_HOLD`）：弹窗切换为法律保留视图，禁用删除按钮，显示保留原因
5. 网络错误：保留弹窗，显示「删除失败，点击重试」

**Idempotency-Key 处理**：
- 每次删除请求生成唯一 `Idempotency-Key`（UUID v4）
- 重试时复用同一 Key，避免重复删除
- 前端不缓存 Key，弹窗关闭后丢弃

**不可撤销**：软删除提交后不可撤销，30 天后物理清除。法律保留项目（`legal_hold`）返回 `409 LEGAL_HOLD`，前端显示"因法律或合同保留义务，该项目不可删除"并禁用确认按钮。


---

## 8. 响应式规格

三模式共用的完整响应式断点表：

| 宽度 | 起始页 | 快速问诊/表达训练 | 正式项目 |
|---|---|---|---|
| > 1280px | 居中布局，prompt bar 最大 640px | 分屏可拖拽，默认 45%/55% | 三栏完整（240 + flex + 320） |
| 1025-1280px | 居中布局 | 分屏可拖拽 | 三栏，左 200px，右栏可折叠 |
| 769-1024px | 全宽 | 分屏固定比例 45%/55%，不可拖拽 | 左栏收窄至 200px，右栏折叠为按钮 |
| 481-768px | 全宽，卡片纵排 | 单栏 tab 切换（对话/可视化） | 单栏 + 底部抽屉（阶段抽屉/追问抽屉） |
| ≤ 480px | 字号缩小，卡片图标隐藏 | 单栏 | 单栏，简化信息（隐藏元数据/次要字段） |

**通用约束**：
- 断点切换不丢失用户输入与选中状态
- 移动端保留同一动态背景语言，但可降低层数、帧率或使用静态关键帧；不得换成另一套视觉
- `prefers-reduced-motion: reduce` 时所有动效降为 0ms

---

## 9. 无障碍规格

> PRD ID：PRD-USABILITY-001、PRD-NFR-001

### 9.1 焦点管理

- 所有交互元素 `:focus-visible`：3px solid `var(--accent-500)`，`outline-offset` 2px
- 页面切换后焦点移至当前 `h1`（`tabindex="-1"`）
- 模态打开焦点圈闭（focus trap），关闭返回触发按钮
- 抽屉使用 `role="dialog"`, `aria-modal="true"`
- Tab 顺序遵循视觉顺序，不跳跃

### 9.2 屏幕阅读器

- 状态提示使用 `aria-live="polite"`（错误用 `aria-live="assertive"`）
- 关系图（影响传播图、目标阶梯）必须有同等信息的文本路径或表格，不以 Canvas 为唯一表达
- 确认/撤回/清除动作具有可理解名称，不使用仅图标按钮
- 图标按钮必须有 `aria-label`
- 表格使用 `<th scope>` 标注表头
- 表单控件关联 `<label>`
- 字段校验失败时提供字段级错误、错误摘要和首个错误焦点；不得只用 Toast

### 9.3 键盘导航

- Tab 顺序遵循视觉顺序
- 列表支持上下方向键导航（`roving tabindex`）
- 标签页支持左右方向键 + `roving tabindex`
- 分割条支持左右方向键调整 1%，`Shift+方向键` 调整 5%
- 七阶段导航支持上下方向键 + Enter 跳转
- 看板拖拽操作必须有“移动到…”菜单等价路径

### 9.4 颜色对比度

| 元素 | 对比度要求 |
|---|---|
| 正文文字 | ≥ 4.5:1（WCAG AA） |
| 大文字（≥ 18px 或 14px bold） | ≥ 3:1 |
| 交互元素 | ≥ 3:1 |
| 状态标识 | 不得只靠颜色，必须同时有文本或图标 |

- 状态徽章同时使用颜色 + 文字 + 图标（对齐 §1.7 图标系统）
- 焦点指示不依赖颜色变化

### 9.5 打印

- A4 纵向，固定页边距（上下 16mm，左右 15mm）
- 表头跨页重复（`thead { display: table-header-group }`）
- 避免关键信息被截断（`break-inside: avoid` 用于卡片）
- 打印前检查三关口和门禁（G0-G6）状态，未通过项显著标注
- 打印内容不依赖屏幕颜色（黑白可读，状态用文字标注）
- Aster Demo 保留现有 `FullReport.tsx` 的 12 章结构；通用报告按模板输出 8–15 章
- 打印样式使用 `@media print`，隐藏导航/操作条/抽屉

---

## 10. 状态机与页面映射

### 10.1 快速问诊状态机

对齐 ADD §12.1：

```text
draft → clarifying → understanding_review → option_review → brief_ready → upgraded/archived
                  ↑__________________________|
```

状态与右栏焦点区域映射：

| 状态 | 右栏焦点 | 左栏行为 |
|---|---|---|
| `draft` | 原始想法卡片 | AI 发起首批追问 |
| `clarifying` | 覆盖槽位实时更新 | AI 逐个追问 |
| `understanding_review` | 摘要 + 所有卡片高亮 | AI 展示理解，用户确认/修改/暂不确定 |
| `option_review` | 方案比较卡片高亮 | AI 展示方案，用户选偏好 |
| `brief_ready` | 切换为简报视图 | 简报生成，可继续补充或升级 |
| `upgraded` | 只读 | 跳转正式项目，记录保留只读 |
| `archived` | 只读 | 用户放弃、归档或升级后保留查看 |

约束：
- 状态转换通过用户操作触发，不自动推进
- `understanding_review` 的"理解正确"不产生正式 ReviewAction
- `brief_ready` 非不可逆终点，可继续补充产生新版本
- `archived` 只能由 `POST /api/quick-sessions/:id/abandon`、`POST /api/quick-sessions/:id/archive` 或升级成功后的只读归档路径进入；归档/放弃不等于删除
- 快速问诊状态不得映射为正式项目状态

### 10.2 正式项目状态机

对齐 ADD §12.2 与 DB v1.2 状态枚举：

```text
Draft → Ingesting → Eliciting → Reviewing → Baselined → Reporting → Released → Changing → Reviewing
                                                     │                    │           │
                                                     └────────────→ Archived ←───────┘
```

状态枚举（对齐 DB `projects.status`）：Draft / Ingesting / Eliciting / Reviewing / Baselined / Reporting / Released / Changing / Archived

**项目状态与七阶段不是一一对应**（一个项目状态可能跨多个阶段，如 Reviewing 覆盖三关口）：

| 项目状态 | 对应阶段 |
|---|---|
| Draft / Ingesting | 1 建档 |
| Eliciting | 2 访谈 |
| Reviewing | 3 目标确认 / 4 冲突与决策 / 5 范围确认 |
| Baselined | 5 范围确认完成 |
| Reporting | 6 分析报告 |
| Released | 6 发布 / 7 变更预演 |
| Changing | 7 变化处理 |
| Archived | 全部只读（v1 无恢复入口，可由 Released 或 Changing 转入） |

约束：
- DomainProfile 候选审核在 Draft 内完成，不额外制造项目状态
- 只有人工确认可从 Reviewing 进入 Baselined
- Blocking Conflict 存在时禁止进入 Baselined
- Released 后变化必须产生新版本
- **重开阶段不创建第二个项目**：影响判断后回退状态机，不新建项目
- Archived 在 v1 界面中只读；未来恢复必须先补状态转换、权限和审计契约


### 10.3 表达训练状态机

对齐 ADD §12.3：

```text
not_started → interviewing → summarizing → feedback_ready → retrying/completed
```

| 状态 | 页面表现 |
|---|---|
| `not_started` | 案例选择页 |
| `interviewing` | 分屏对话进行中 |
| `summarizing` | 右栏切换为总结输入 |
| `feedback_ready` | 右栏切换为反馈视图 |
| `retrying` | 重置对话，保留旧反馈 |
| `completed` | 训练结束页 |

约束：
- 训练状态不映射为正式项目状态
- 不产生正式 Fact/Requirement/Decision/ReviewAction
- `feedback_ready` 后允许重新练习，保留旧反馈
- `completed` 不代表权威能力认证

---

## 11. 实现状态与差异清单

### 11.1 已完成项（保留现有实现）

| 项 | 当前实现 | v2.3 处理 |
|---|---|---|
| 首页三模式入口 | `ReqClinic/app/page.tsx` 与 start 组件 | 保持三入口同级，继续精修文案层级 |
| 快速问诊真实链路 | `/quick`、`/quick/[sessionId]`、quick 组件 | 保持真实输入与案例演示双轨，继续做浏览器体验回归 |
| 快速简报 | `/quick/[sessionId]/brief` | 保持概述/详细报告、继续补充、升级正式项目 |
| 正式项目建档 | `/formal/new`、`formal-new-page.tsx` | 保持真实创建 `formal_guidance` Job |
| 正式项目地图工作台 | `/formal/[projectId]`、`formal-analysis-page.tsx` | 保持左侧对话 + 右侧可扩展地图；旧七阶段仅作后台治理候选 |
| 表达训练真实链路 | `/training/cases`、`/training/[attemptId]` | 继续做真实浏览器体验、反馈质量和移动端回归 |

### 11.2 MockTransport 演示层架构

页面组件和业务状态只调用统一类型化 ApiClient。演示环境可以注入 MockTransport；MSW handlers 可以作为该传输的实现方式，在浏览器内按 operationId 返回预生成 Fixture，禁止回退到真实业务网络：

- 前端代码与 API 契约 1:1 对齐（operationId、路径、字段、枚举、状态码、错误体），真实链路只替换为 HttpTransport
- 协议同意、Job 轮询、材料上传、删除流程、报告编译/发布/下载等流程均可端到端演示
- AI 内容为 Fixture 预生成（不调用真实模型），但返回格式与真实 Job 结果一致
- 页面组件不得直接导入 Fixture；FixtureRepository 只允许被 Mock handler 调用
- 自定义输入通过 MockTransport 创建本地快速问诊会话，不发送到示例分析 handler；未注册 operation、Schema 不匹配和开发/生产业务网络请求立即失败
- Mock 身份、协议、删除和 Job 仅是本地演示状态，不形成真实凭证、法律记录、数据库事务或物理删除

Mock 层覆盖范围：§2.3 协议同意 5 端点、§3.3.4 Job 轮询（8 个 AI 写命令的 202+job_id+状态机）、§7.9 删除流程、§6.3 材料上传、报告编译/发布/下载及正式项目 API。所有 handler 必须通过 OpenAPI 契约测试。

### 11.3 演示链路必须覆盖能力（不改变外观）

| 项 | 说明 |
|---|---|
| 起始页正式视觉 | 浅色工作画布 + 低速动态背景 + 产品流程签名；演示/真实链路共用同一背景组件 |
| 快速问诊工作台 | 左侧对话 + 右侧逐步整理内容 + 卡片引用到输入框 |
| 表达训练工作台 | 案例选择 + 左侧追问练习 + 右侧目标/覆盖反馈 |
| 需求简报页面 | 概述/详细报告切换 + 版本列表 + 指定版本查看 + 导出 |
| 可拖拽分割条组件 | 4px/8px hover，25%-75% 范围，localStorage 持久化 |
| 多选卡片引用交互 | 单击/Ctrl + 可见多选模式 + 引用条（支持触屏与键盘） |
| 双案例 Fixture | AI 海报 + Aster，预生成内容 |
| 设计令牌迁移 | `globals.css` 重构为 §1 令牌系统 |
| 三模式独立状态机 | 拆分 `lib/machine.ts` 为三模式 |
| 起始页三入口 | 快速问诊示例 + 正式项目示例 + 训练入口 |
| 协议同意流程 | 同一协议 UI；演示链路使用 Mock 同意记录，真实链路执行游客会话恢复/签发 → 获取协议引用 → 主动同意 → AGREEMENT_REQUIRED 引导 |
| Job 轮询组件 | 覆盖 8 个 AI 写命令的 `202 + job_id` 异步响应与状态机（§7.8） |
| 删除流程 UI | 项目/会话删除确认弹窗，含范围说明、estimated_purge_at、409 LEGAL_HOLD（§7.9） |
| 材料上传 UI | POST /api/projects/:id/sources（multipart/form-data），sensitivity 徽章、extraction_status、byte_size（§6.3 建档） |
| 领域画像生成与评审 UI | POST /api/projects/:id/analysis-runs 且 task=domain_profile，评审 accept/modify/reject/uncertain（§6.3 建档） |
| 报告编译/发布/下载流程 | 异步 Job 流程：编译 → 轮询 → 发布门禁 → 下载 PDF（§6.3 报告） |
| 正式项目 API 调用绑定 | 文档和开发调试抽屉标注数据来源/触发命令；正式用户界面不显示技术路径 |


### 11.4 后续补齐能力

> PRD ID：PRD-ANALYTICS-001

| 项 | 说明 |
|---|---|
| 游客会话与认领 | 游客开始 → 登录 → 认领会话 |
| 升级正式项目流程 | 快速问诊 → 正式项目，幂等键，候选状态迁移 |
| 待办任务管理 UI | 待确认事项的创建/分配/完成 |
| 产品埋点接入 | 演示链路使用本地接收器；真实链路接 `/api/events` 和最小 SQL 报表，均不含业务正文 |
| 实体变更审计展示 UI | 证据/模型/人工修改历史可视化 |
| 表达训练真实 Runtime | 已接后端 `training_response / training_feedback` Job、隐藏案例信息、训练审计和浏览器验收；后续持续精修 |
| 简报可用性反馈组件 | 简报下载后收集可用性评分与缺失项反馈（§4.6） |
| 项目成员管理 UI | 成员邀请、角色分配、权限管理 |


### 11.5 非当前基线候选

以下内容没有对应当前 PRD 承诺，不属于 v2.2 实现范围；不得因为出现在旧稿中提前开发。需要时先新增 PRD ID、验收标准和受影响契约：

| 候选 | 进入条件 |
|---|---|
| 训练案例编辑器 | 定义案例作者、审核、发布、版本和权限模型后 |
| 维度图形评分 | API 返回经验证的维度分数且可用性测试证明优于列表后 |
| 密度切换、暗色模式、命令面板、批量操作 | 形成性评估或真实使用数据证明优先级后 |
| 离线补发 | 明确事件队列上限、保留、去重和隐私契约后 |

---

## 12. 验收标准

### 12.1 自动检查

| 检查项 | 标准 |
|---|---|
| TypeScript | 0 错误 |
| ESLint | 0 错误 |
| axe-core 无障碍 | 0 违规 |
| Lighthouse CI | 合成测试用于回归并设固定预算，不把单次 Lighthouse 结果写成 P75 |
| 真实用户性能 | 真实 HTTP 试点按环境、样本量报告 LCP/INP/CLS P75，目标分别 ≤2.5s/200ms/0.1 |

补充对齐 ADD §13.2 质量目标：
- 已接受事实的引用可定位率 = 100%
- 正式报告无来源事实 = 0
- 报告中不存在领域模型外的新事实 = 0
- 模型调用可追踪率 = 100%
- 报告快照可关联数据版本率 = 100%

### 12.2 手工检查

- 三模式主路径走通（快速问诊 / 正式项目 / 表达训练）
- 起始页无持续装饰动画、无 WebGL/Canvas 依赖；主输入和三个入口在目标设备稳定可读
- 分屏可拖拽且持久化（刷新后比例保留）
- 多选引用在鼠标、触屏和仅键盘三种输入方式下可完成
- 响应式三断点验证（1024px / 768px / 480px）
- Aster Demo PDF 12 章完整；通用报告按实际模板 8–15 章，A4、跨页表头和状态文字正确
- 键盘完整可操作（Tab 顺序、方向键、Esc 关闭、Enter 确认）
- 七阶段可查看和必要回退；点击导航不能绕过前置、关口或服务端状态转换，重开阶段不创建第二个项目
- 三关口动作按钮真实可用（确认/修改/暂不确定）
- 方案比较表所有方案可选（无 disabled）

### 12.3 形成性可用性

对齐 PRD §12.4 与 ADD §13.5.0：

- 每种进入试验的模式首轮至少招募 8 名目标或相邻用户
- 快速问诊优先测试非专业用户，正式模式优先测试有项目责任经验的用户
- 训练模式同时需要学习者和具备需求分析经验的人工复核者
- 预先固定任务和评分量表，不因结果不好临时删除失败样本
- 记录：用户背景、任务完成、用时、误操作、口头理解、输出修改量、实际用途
- 未达到目标时先调整定位、问题顺序和交互，不以增加文档长度替代可用性改进

**快速问诊核心指标**（对齐 PRD §12.1）：
- 主路径完成率
- 理解确认正确率
- 简报可用性评分

**评估结果处理**：通过 → 对应假设从 Trial 晋级 Accepted；不通过 → 改为 Deprecated 或 Superseded 并记录替代方案。


### 12.4 v2.2 关键契约验收

针对 v2.1–v2.2 引入并修订的异步 Job、协议同意、删除、报告编译与发布流程，执行以下验收：

**Job 轮询组件（§7.8）**：
- 覆盖 8 个 AI 写命令的 `202 + job_id` 响应（项目候选生成、分析运行、报告编译、快速问诊追问、理解确认、方案偏好记录、简报生成、训练追问）
- 8 个 Job 状态（queued/running/validating/retry_wait/manual_review/succeeded/failed/cancelled）均有对应视觉
- 轮询间隔正确（2s 起步，指数退避序列 2→4→8→16→30s，页面隐藏时暂停）
- 终态自动停止轮询
- 同一次命令的网络重试复用原 Idempotency-Key 并返回同一 Job；终态失败后的明确重新执行才使用新 Key

**协议同意流程（§11.3 P0）**：
- 游客会话签发 → 获取协议 → 展示正文 → 提交同意 → AGREEMENT_REQUIRED 引导
- 演示链路自定义问诊使用 MockTransport，不要求真实协议且不调用真实 API；真实链路只有 API §2.2 列出的 11 个真实 AI/流程入口执行协议前置，不把所有写操作一概阻断
- 同意后状态持久化，刷新后不丢失

**删除流程（§7.9）**：
- 项目删除（`DELETE /api/projects/:id`）与会话删除（`DELETE /api/quick-sessions/:id`）均含二次确认弹窗
- 弹窗先显示删除范围；提交后才显示服务端 `estimated_purge_at` 或处理 `409 LEGAL_HOLD`
- 请求携带 Idempotency-Key（UUID v4），重试复用
- `202` 后可按 `delete_task_id` 查询任务状态

**报告编译/发布/下载流程（§6.3 分析报告）**：
- 触发编译返回 `202 + job_id`，前端进入 Job 轮询
- 轮询只显示 Job `progress/current_step`；Aster Fixture 可显示 12 章，通用模板不硬编码章节数
- 发布门禁触发 G0-G6 校验，未通过返回 `409 BLOCKING_CONFLICT`；页面按类型化 `gate_defects` 展示 gate 详情，响应不符合 Schema 时保持验收阻断
- 失败门禁在 UI 中高亮，发布按钮被阻止
- 下载同时支持 `200 application/pdf` 文件流与 `302` 临时签名 URL
- 全程不调用 `window.print()`（§9.5 仅作为离线兜底）

**正式项目 API 调用绑定**：
- 数据来源和触发命令存在于本 FSD、开发调试抽屉和测试属性，生产用户界面不显示 API/DB 技术标注
- 三关口均为四按钮模式；所有动作填写 `reason`，modify 提交 `after_value`，uncertain 提交 `follow_up`
- 目标确认与范围确认的 PATCH 请求携带 `expected_version`，并发冲突返回 `409 VERSION_CONFLICT`
