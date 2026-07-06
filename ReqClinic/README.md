# ReqClinic 前端

这是需求问诊室 / Requirements Clinic 的 Next.js 前端应用，覆盖首页、快速问诊、需求简报、正式项目地图和表达训练。

## 运行

```bash
npm install
npm run dev
```

默认访问：`http://localhost:3000`。

连接本地后端时设置：

```powershell
$env:NEXT_PUBLIC_API_TRANSPORT = "http"
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:4200/api/v1"
npm run dev
```

未设置 HTTP 后端时，前端会回退到本地 mock transport，用于示例体验和界面开发。

## 检查

```bash
npm run typecheck
npm run build
```

## 目录结构

- `app/`：Next.js App Router 页面。
- `components/`：首页、快速问诊、正式项目、表达训练、简报和通用 UI。
- `fixtures/`：示例体验数据。
- `lib/`：API client、产品语言、状态存储和工具函数。
- `machines/`：快速问诊、正式项目和训练状态机。
- `mocks/`：Mock transport 与本地处理器。

前端不保存或展示模型 API key。真实模型调用必须经由后端完成。
