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
- Celery 5 + Redis（四队列：`pingcha` / `pingcha.pipeline` / `pingcha.curate` / `pingcha.cron`）
- LiteLLM（多模型摘要）/ Whisper（ASR）/ yt-dlp（字幕）

**前端**
- Next.js 15 + React 19，standalone 输出模式
- Jotai（播放器状态）/ TanStack Query（服务端数据）
- xgplayer（HLS 视频播放）/ Shadcn/ui + Tailwind CSS 4

**基础设施**
- Docker Compose（10 服务：frontend / backend / db / redis / minio / celery×4 / nginx）
- Nginx 反向代理（`/api` → backend:8000）
- MinIO（S3 兼容对象存储）

---

## 快速开始

### 1. 克隆项目并配置环境变量

```bash
git clone https://github.com/6ackpacks/pincha.git
cd pincha
cp .env.example .env
```

### 2. 配置 AI 服务（必须）

品猹的 AI 功能（摘要、知识图谱、向量检索）统一通过 **TokenDance** 网关接入，只需一个 API Key：

1. 注册 [TokenDance](https://tokendance.space)，获取 API Key
2. 在 `.env` 中填入：

```bash
OPENAI_API_KEY=sk-your-tokendance-api-key
SUMMARY_API_BASE=https://tokendance.space/gateway/v1
```

这一步完成后，摘要生成、Wiki 编译、Embedding 向量化、Whisper ASR 等全部 AI 功能即可使用。

### 3. 配置字幕获取（推荐）

视频字幕是整个处理管线的入口。推荐配置 **TikHub** 实现零代理字幕获取：

1. 注册 [TikHub](https://tikhub.io)，获取 API Key（约 0.001 元/次）
2. 在 `.env` 中填入：

```bash
TIKHUB_API_KEY=your-tikhub-api-key
```

TikHub 服务端代理 YouTube API，国内服务器无需翻墙即可获取字幕。如果不配置 TikHub，系统会回退到 `youtube-transcript-api` 和 `yt-dlp`（需要代理环境）。

### 4. 安全配置

```bash
# 生成 JWT 密钥（生产环境必须修改！）
python -c "import secrets; print(secrets.token_urlsafe(32))"
# 将输出填入 .env 的 JWT_SECRET_KEY
```

> ⚠️ 默认的数据库密码、MinIO 密钥、JWT 密钥仅供本地开发。生产部署前务必全部替换为强随机值。

### 5. 启动服务

```bash
# Docker 全栈启动
docker-compose up -d

# 数据库迁移
docker-compose exec backend alembic upgrade head
```

访问 http://localhost 即可使用。

### 6. 验证配置

提交一个 YouTube 视频 URL 测试完整管线：
- 字幕提取成功 → TikHub 或 yt-dlp 工作正常
- 摘要生成成功 → TokenDance API 工作正常
- 如果字幕提取失败但显示"ASR 语音识别中" → 说明正在使用 Whisper 兜底（正常）

---

## 本地开发（不使用 Docker）

```bash
# 基础设施（数据库 + Redis）
docker-compose -f docker-compose.infra.yml up -d

# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev   # http://localhost:3000

# Celery worker（在 backend/ 目录下）
celery -A app.tasks.celery_app worker -Q pingcha -c 4
```

---

## Docker 架构

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

### Celery Workers

| Worker | 队列 | 并发 | 职责 |
|--------|------|------|------|
| celery_fast | `pingcha` | 4 | 通用任务（摘要、ASR） |
| celery_pipeline | `pingcha.pipeline` | 10 | 视频/文章处理管线 |
| celery_cron | `pingcha.cron` | 1 | 定时任务 |
| celery_curate | `pingcha.curate` | 2 | 内容遴选 pipeline |
| celery_beat | — | — | 定时任务调度器 |

---

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
pincha/
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

详见 `.env.example`，按用途分组：

| 分组 | 关键变量 | 说明 |
|------|---------|------|
| **AI 功能** | `OPENAI_API_KEY` | TokenDance API Key，驱动所有 AI 能力 |
| | `SUMMARY_API_BASE` | TokenDance 网关地址 |
| **字幕获取** | `TIKHUB_API_KEY` | TikHub 字幕服务（推荐，国内免代理） |
| | `YOUTUBE_PROXY` | yt-dlp 代理（不用 TikHub 时需要） |
| **基础设施** | `DATABASE_URL` | PostgreSQL 连接串 |
| | `REDIS_URL` | Redis 连接串 |
| | `MINIO_*` | 对象存储配置 |
| **安全** | `JWT_SECRET_KEY` | JWT 签名密钥（≥32 字符） |
| | `ADMIN_TOKEN` | 管理后台 Token |
| **认证** | `WATCHA_*` | 观猹 OAuth2 配置 |

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

## License

[Apache License 2.0](LICENSE)
