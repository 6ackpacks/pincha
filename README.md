# 品猹 (Pingcha)

**Where Content Becomes Knowledge**

**让信息有归处**

*开源项目 · 主要开发：[@6ackpacks](https://github.com/6ackpacks/pincha)*

![Python 3.11](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi)
![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-blue?logo=postgresql)
![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis)

---

## 项目概述

品猹是一个 AI 驱动的内容学习书房，将视频、播客、文章与每日线索汇入一套完整的学习工作流。系统通过 AI 管线提炼要点、梳理脉络，并把零散信息整理为可检索、可追问的个人知识库。

## 功能模块

### 品读 · 内容整理

支持视频、播客与文章的全流程 AI 品读：

| 能力 | 说明 |
|------|------|
| **字幕提取** | yt-dlp 优先获取平台字幕，失败时自动回退 Whisper ASR，支持中英双语 |
| **四级摘要** | Express (5%) / Highlight (30%) / Detailed (60%) / Full (90%)，LiteLLM 多模型支持 |
| **转录同步** | 播放时间与字幕段落二分查找实时对齐，Jotai atom 驱动前端高亮 |
| **脉络图** | AI 自动生成 React Flow 节点图，可视化内容知识结构 |

### 知识库 · RAG 检索

将视频、播客、文章等内容向量化入库，支持跨内容语义检索与知识追问：

| 能力 | 说明 |
|------|------|
| **向量存储** | pgvector 存储文本 chunk 嵌入，支持相似度检索 |
| **知识追问** | 基于检索增强生成（RAG），在知识库范围内精准回答 |
| **猹选订阅** | 支持内容频道订阅，自动拉取值得细读的新线索 |

### Wiki · 知识编译

从内容库中自动提炼、组织结构化知识文档，形成可持续维护的 Wiki 体系。

---

## 技术栈

**后端**
- FastAPI + SQLAlchemy async + asyncpg（PostgreSQL 16 + pgvector）
- Celery 5 + Redis（三队列：`pingcha` / `pingcha.pipeline` / `pingcha.cron`）
- LiteLLM（多模型摘要）/ faster-whisper（ASR）/ yt-dlp（字幕）

**前端**
- Next.js 15 + React 19，standalone 输出模式
- Jotai（播放器状态）/ TanStack Query（服务端数据）
- xgplayer（HLS 视频播放）/ Shadcn/ui + Tailwind CSS 4

**基础设施**
- Docker Compose（10 服务：frontend / backend / db / redis / minio / celery×4 / nginx）
- Nginx 反向代理（`/api` → backend:8000）
- MinIO（S3 兼容对象存储）

---

## Docker 架构与端口映射

### 服务拓扑

```
                    ┌─────────────────────────────────────────────┐
                    │              Nginx (端口 80)                  │
                    │   /api/*  → backend:8000                     │
                    │   其他    → frontend:8080                     │
                    └────────────┬──────────────┬─────────────────┘
                                 │              │
                    ┌────────────▼──┐    ┌──────▼──────────┐
                    │  Backend      │    │  Frontend       │
                    │  FastAPI      │    │  Next.js 15     │
                    │  容器内:8000   │    │  容器内:8080     │
                    │  宿主机:8000   │    │  宿主机:3000     │
                    └───────┬───────┘    └─────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
     ┌────────▼──┐  ┌──────▼──┐  ┌──────▼──┐
     │ PostgreSQL │  │  Redis   │  │  MinIO   │
     │ :5432      │  │  :6379   │  │  :9000   │
     └────────────┘  └──────────┘  └──────────┘
```

### 端口映射表

| 服务 | 容器内端口 | 宿主机端口 | 说明 |
|------|-----------|-----------|------|
| **nginx** | 80 | **80** | 主入口，反向代理 |
| **frontend** | 8080 | 3000 | Next.js dev server（Turbopack） |
| **backend** | 8000 | 8000 | FastAPI |
| **db** | 5432 | 5432 | PostgreSQL 16 + pgvector |
| **redis** | 6379 | 6379 | Redis 7 |
| **minio** | 9000/9001 | 9000/9001 | S3 存储 / 控制台 |
| **content-service** | 8000 | 8100 | 内容服务（独立微服务） |
| **bgutil-provider** | 4416 | 4416 | YouTube PoT 提供者 |

### Celery Workers

| Worker | 队列 | 并发 | 职责 |
|--------|------|------|------|
| celery_fast | `pingcha` | 4 | 通用任务（摘要、ASR） |
| celery_pipeline | `pingcha.pipeline` | 10 | 视频/文章处理管线 |
| celery_cron | `pingcha.cron` | 1 | 心跳检查 |
| celery_curate | `pingcha.curate` | 2 | 内容遴选 pipeline |
| celery_beat | — | — | 定时任务调度器 |

### 定时任务

| 任务 | 触发时间（北京） | 说明 |
|------|----------------|------|
| `daily_curate_pipeline` | 每日 05:00 | 拉取昨日内容 → 评分 → LLM 分类 → 入库 |
| `send_daily_notifications` | 每日 08:00 | 创建通知 + 发送邮件摘要 |

### 启动命令

```bash
# 完整启动（首次或重建后）
docker-compose up -d

# 仅重启前端（不丢失 node_modules）
docker-compose restart frontend

# 如果前端报 MODULE_NOT_FOUND 错误
docker-compose stop frontend
docker-compose rm -f frontend
docker-compose up -d frontend
# 等待 ~90s（npm install + 编译）

# 查看前端编译状态
docker-compose logs frontend --tail 5
# 看到 "✓ Ready in Xs" 表示启动成功
```

### 注意事项

- **Frontend 监听 8080 端口**（不是 3000），Dockerfile 中配置。宿主机通过 `3000:8080` 映射访问
- **Nginx 代理到 frontend:8080**，不是 frontend:3000
- **Frontend 使用匿名 volume** (`/app/node_modules`) 隔离容器内的 Linux 二进制依赖和宿主机的 macOS 依赖
- **首次启动需要等待 npm install**（约 60-90 秒），之后重启会复用缓存
- **访问入口是 `http://localhost:80`**（nginx），不要直接访问 3000 端口

---

## 快速开始

> ⚠️ **安全配置必读**
> 
> 在生产环境部署前，**必须**修改以下配置：
> 
> 1. **JWT 密钥**：在 `.env` 中设置 `JWT_SECRET_KEY`，使用至少 32 字符的随机字符串
>    ```bash
>    # 生成强随机密钥
>    python -c "import secrets; print(secrets.token_urlsafe(32))"
>    ```
> 2. **数据库密码**：修改 `.env` 中的 `POSTGRES_PASSWORD`（默认 `postgres` 仅供本地开发）
> 3. **MinIO 密钥**：修改 `MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD`（默认 `minioadmin` 仅供本地开发）
> 4. **管理员 Token**：设置 `ADMIN_TOKEN` 为强随机字符串
> 
> **默认配置仅供本地开发使用，生产环境使用默认密钥存在严重安全风险！**

### 1. 克隆项目并配置环境变量

```bash
# 复制环境变量
cp .env.example .env
# 填写 OPENAI_API_KEY / DATABASE_URL 等
```

### 2. 启动所有服务

```bash
docker-compose up -d
```

### 3. 执行数据库迁移

```bash
docker-compose exec backend alembic upgrade head
```

访问 http://localhost 即可使用。

## 本地开发

### 一键启动脚本（不使用 Docker）

```bash
# macOS/Linux 一键启动所有服务
bash start-local.sh all

# 单独启动某个服务
bash start-local.sh [infra|backend|celery|pipeline|cron|beat|frontend]

# Windows
.\start-local.ps1
```

### 手动启动各服务

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev   # http://localhost:3000

# Celery worker
celery -A app.tasks.celery_app worker -Q pingcha -c 4
```

## 数据模型

```
videos          — URL / 平台 / 标题 / 缩略图 / 状态 (JSONB)
transcripts     — 字幕段落 (JSONB: [{start, end, text}])
summaries       — 四级摘要，unique(video_id, level)
mindmaps        — React Flow JSON，unique per video
chunks          — 向量化文本块 (pgvector)
subscriptions   — 内容源订阅
wiki            — 编译后的知识文档
```

## 目录结构

```
pingcha/
├── backend/
│   ├── app/
│   │   ├── api/v1/        # FastAPI 路由
│   │   ├── models/        # SQLAlchemy 模型
│   │   ├── services/      # 业务逻辑
│   │   └── tasks/         # Celery 任务
│   └── alembic/           # 数据库迁移
├── frontend/
│   ├── app/               # Next.js App Router 页面
│   │   ├── videos/        # 品读·内容整理
│   │   ├── knowledge/     # 知识库
│   │   ├── learn/         # 学习空间
│   │   └── curate/        # 内容策展
│   ├── components/        # React 组件
│   └── lib/               # API 客户端 / 工具函数
├── nginx/                 # Nginx 配置
└── docker-compose.yml
```

## 环境变量

⚠️ **生产环境必须修改所有默认密钥和密码！** 详见"快速开始"章节的安全警告。

参见 `.env.example`，关键变量：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `OPENAI_API_KEY` | LLM API 密钥（LiteLLM 支持多提供商） |
| `MINIO_*` | 对象存储配置 |
| `WHISPER_MODEL` | ASR 模型大小（默认 `base`） |

## 认证系统说明

当前版本使用观猹（Watcha）OAuth2 进行用户认证。如果你想使用其他认证方式：

### 选项 1：使用观猹 OAuth
1. 访问 [观猹开放平台](https://watcha.cn) 注册账号
2. 创建 OAuth 应用获取 `CLIENT_ID` 和 `CLIENT_SECRET`
3. 在 `.env` 中配置相应变量

### 选项 2：替换为其他 OAuth 提供商
参考 `backend/app/api/v1/auth.py` 修改 OAuth 流程，支持的提供商包括：
- GitHub OAuth
- Google OAuth
- 自定义 OAuth2 服务器

我们计划在未来版本中支持多种认证方式。欢迎贡献代码！

