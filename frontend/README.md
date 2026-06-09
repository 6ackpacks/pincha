# Pingcha Frontend

品猹视频分析平台前端，基于 Next.js 15 + React 19 构建。

## 技术栈

- **框架**: Next.js 15 (App Router, Turbopack, standalone output)
- **UI**: Shadcn/ui + Radix UI + Tailwind CSS 4
- **状态管理**: Jotai (播放器同步) + TanStack Query (服务端数据)
- **视频播放**: xgplayer + HLS
- **图表/可视化**: React Flow, Sigma.js, Markmap
- **类型**: TypeScript strict mode
- **测试**: Vitest (单元) + Playwright (E2E)
- **监控**: Sentry

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与启动

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

开发服务器默认运行在 http://localhost:3000

### 环境变量

复制 `.env.example` 到 `.env.local` 并按需配置：

```bash
cp .env.example .env.local
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NEXT_PUBLIC_API_URL` | 前端直连后端地址 | (Docker 环境无需配置) |
| `BACKEND_URL` | next.config.ts rewrites 目标 | `http://backend:8000` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry 错误追踪 (可选) | - |

在 Docker 环境中，API 请求通过 nginx 代理到后端，无需额外配置。本地开发直连后端时需设置 `NEXT_PUBLIC_API_URL`。

## 项目结构

```
frontend/
├── app/              # Next.js App Router 页面
│   ├── landing/      # 公开落地页
│   ├── videos/       # 视频分析页
│   ├── curate/       # 内容策展
│   ├── library/      # 知识库
│   ├── trending/     # 热门内容
│   └── login/        # 登录
├── components/       # React 组件（按功能模块分目录）
├── atoms/            # Jotai 状态原子
├── hooks/            # 自定义 React Hooks
├── lib/              # 工具库和 API 客户端
│   ├── api/          # 按业务领域拆分的 API 模块
│   └── constants/    # 常量定义
├── types/            # TypeScript 类型声明
├── tests/            # 测试文件
│   ├── unit/         # Vitest 单元测试
│   ├── e2e/          # Playwright E2E 测试
│   └── mocks/        # 测试 mock 数据
├── public/           # 静态资源
└── scripts/          # 辅助脚本
```

## 开发命令

```bash
npm run dev            # 开发服务器 (Turbopack, port 3000)
npm run build          # 生产构建
npm run start          # 启动生产服务器
npm run lint           # ESLint 检查
npm run test           # 运行单元测试
npm run test:watch     # 单元测试 (watch 模式)
npm run test:coverage  # 单元测试 + 覆盖率
npm run test:e2e       # 运行 E2E 测试
npm run test:e2e:ui    # E2E 测试 (UI 模式)
```

## 约定

- 路径别名: `@/*` 映射到项目根目录
- 组件库: 使用 Shadcn/ui (New York 风格)，通过 `npx shadcn@latest add <component>` 添加
- API 客户端: 统一使用 `lib/api/` 下的类型化 fetch wrapper
- 样式: Tailwind CSS utility classes，避免自定义 CSS
- 包管理: 使用 npm（非 pnpm）

## Docker 部署

项目提供 `Dockerfile` 用于生产构建（standalone output），`Dockerfile.dev` 用于开发环境。通过根目录 `docker-compose.yml` 统一编排，nginx 反向代理将 `/api` 路由转发到后端服务。
