# 需求问诊室 / Requirements Clinic

需求问诊室是一个 AI 需求分析与表达训练原型，目标是把模糊想法通过连续追问整理成可执行的需求简报、项目需求地图和训练反馈。

当前仓库包含前端、后端和项目文档：

- `ReqClinic/`：Next.js 前端应用。
- `backend/`：Fastify + SQLite 后端，包含 Quick/Formal/Training 的 Agent + Skill Runtime。
- `docs/`：PRD、架构、API、数据库、交互流程、后端 Agent/Skill、设计语言、验收标准和案例矩阵。

## 本地运行

### 1. 安装依赖

```bash
cd backend
npm install

cd ../ReqClinic
npm install
```

### 2. 配置环境变量

前端和后端分别提供模板：

- `backend/.env.example`
- `ReqClinic/.env.example`

本地真实模型调用只在后端配置。不要把真实 API key 写入仓库。

### 3. 启动后端

```powershell
cd backend
$env:PORT = "4200"
$env:AI_PROVIDER = "stub"
npm run dev
```

如需接入 OpenAI-compatible provider，按 `backend/.env.example` 设置 `OPENAI_COMPAT_*` 环境变量。

### 4. 启动前端

```powershell
cd ReqClinic
$env:NEXT_PUBLIC_API_TRANSPORT = "http"
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:4200/api/v1"
npm run dev
```

默认访问地址：`http://localhost:3000`。

## 常用检查

```bash
cd backend
npm run typecheck
npm test

cd ../ReqClinic
npm run typecheck
npm run build
```

AI 审计摘要：

```bash
cd backend
npm run audit:ai
```

## 上传前约定

仓库不应提交本地运行数据库、构建产物、日志、截图、备份、测试结果、`.env.local`、`node_modules` 或本地工具目录。相关规则已写入根目录 `.gitignore`。
