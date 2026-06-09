# CLAUDE.md

本文件为 agent 在品猹仓库中的执行手册。
仅适用于 `/Users/Admin/project/ping_cha` 下的代码。

## 范围

- 优先稳定性、可预测行为、小规模安全重构。
- 品猹的特殊约束：单人开发、AI agent 协作、多模块联动（视频/Wiki/精选/文章）、中文用户优先、快速迭代。
- 除非任务明确要求，不做大型架构重写。
- 不要把 SurfSense 原始架构假设混入品猹——品猹已大幅偏离 SurfSense 基座。
- 业界经验是参考输入，不是答案——反推方案的起点是品猹的实际约束。

## 快速开始

```bash
# 全栈 Docker
docker-compose up -d
docker-compose down
docker-compose logs -f backend

# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
alembic upgrade head
alembic revision --autogenerate -m "描述"

# Celery workers（在 backend/ 目录下运行）
celery -A app.tasks.celery_app worker -Q pingcha -c 4
celery -A app.tasks.celery_app worker -Q pingcha.pipeline -c 10
celery -A app.tasks.celery_app worker -Q pingcha.curate -c 2
celery -A app.tasks.celery_app worker -Q pingcha.cron -c 1
celery -A app.tasks.celery_app beat

# 前端
cd frontend
npm install
npm run dev       # 开发服务器 :3000
npm run build     # 生产构建
npm run lint      # ESLint
```

## 项目事实

- 项目名：品猹（Pingcha）
- 定位：多媒体知识管理平台（视频解析 + 知识图谱 + 内容精选）
- 面向用户：中文用户，摘要/prompt 均为中文
- 环境变量：`.env.example` → `.env`，Docker 用内部主机名（db, redis, minio）

### 技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 后端框架 | FastAPI + Uvicorn | 0.115 / 0.30 |
| 数据库 | PostgreSQL + pgvector | pg16 |
| ORM | SQLAlchemy async + asyncpg | 2.0.36 |
| 任务队列 | Celery + Redis | 5.4 / 7-alpine |
| LLM | LiteLLM + OpenAI SDK | 1.80 / 2.8 |
| 视频下载 | yt-dlp | 2026.3 |
| ASR | Whisper / 讯飞 / 火山引擎 | — |
| 前端框架 | Next.js + React | 15.0 / 19.0 |
| 状态管理 | Jotai + TanStack Query | 2.10 / 5.60 |
| UI | Shadcn/ui + Radix + Tailwind CSS | 4.0 |
| 播放器 | xgplayer + HLS | 3.0 |
| 图谱可视化 | Sigma.js + Graphology | 3.0 / 0.26 |
| 思维导图 | Markmap | 0.18 |
| 测试 | Playwright + Vitest | 1.60 / 3.2 |
| 监控 | Sentry | 2.0 (后端) / 10.48 (前端) |
| 文件存储 | MinIO | 7.2 |
| 反向代理 | Nginx | alpine |

## 当前架构

### 后端（`backend/app/`）

```
backend/app/
├── api/v1/                  # REST 端点
│   ├── auth.py              # OAuth2/JWT（观猹平台）
│   ├── videos.py            # 视频 CRUD + SSE 进度
│   ├── transcripts.py       # 字幕管理
│   ├── summaries.py         # 4 级摘要
│   ├── mindmaps.py          # 思维导图
│   ├── articles.py          # 文章系统
│   ├── curate_v2.py         # 内容精选（频道/订阅/每日精选）
│   ├── admin.py             # 管理后台
│   ├── knowledge_base/      # 用户知识库 + RAG
│   └── wiki/                # Wiki 知识图谱
├── models/                  # SQLAlchemy ORM
├── schemas/                 # Pydantic 请求/响应
├── services/                # 业务逻辑层
├── tasks/                   # Celery 异步任务
├── core/                    # 认证/数据库/Redis/限流/中间件
└── config.py                # Pydantic Settings
```

### 核心业务模块

| 模块 | 职责 | 关键文件 |
|------|------|---------|
| 视频处理 | URL → 字幕 → 摘要 → 思维导图 → 向量化 | `services/video_service.py`, `tasks/video_tasks.py` |
| 字幕系统 | yt-dlp 平台字幕 > ASR 兜底，多语言翻译 | `services/subtitle_service.py`, `audio_asr.py` |
| 摘要系统 | 4 级摘要（express/highlight/detailed/full） | `services/summary_service.py` |
| 文章系统 | URL 导入 → 内容提取 → 摘要/思维导图 | `services/article_service.py`, `tasks/article_tasks.py` |
| Wiki 图谱 | 从视频/文章编译 Wiki 页面，实体抽取，关系图 | `services/wiki_compiler_service.py`, `wiki_entity_service.py` |
| 内容精选 | 频道订阅 + 每日精选 + 深度分析 | `tasks/curate_v2_tasks.py`, `api/v1/curate_v2.py` |
| 播客 | 音频处理 + 说话人分离（讯飞/火山） | `services/podcast_audio_service.py` |
| 知识库 RAG | 文档分块 → pgvector embedding → 检索 | `services/rag_service.py` |

### Celery 队列架构

| 队列 | 并发 | 内存 | 用途 |
|------|------|------|------|
| `pingcha` | 4 | 600M | 快速处理（摘要生成等） |
| `pingcha.pipeline` | 10 | 800M | 长流程（完整视频管道） |
| `pingcha.curate` | 2 | 400M | 内容精选数据更新 |
| `pingcha.cron` | 1 | 200M | 定时任务 |
| `celery_beat` | — | 150M | 调度器 |

### 前端（`frontend/`）

```
frontend/app/
├── page.tsx                    # 首页
├── landing/                    # 落地页（暗色主题）
├── login/                      # 登录
├── videos/ + [id]/             # 视频列表 + 详情
├── articles/ + [id]/           # 文章系统
├── knowledge/ + [slug]/        # 知识库 + Wiki
├── curate/ + [slug]/ + preview/  # 精选频道
├── library/{feed,videos,subscriptions}  # 用户库
├── trending/                   # 热门
├── admin/{dashboard,videos,curate,users,trending}  # 管理后台
└── notifications/              # 通知中心
```

### 关键前端组件

| 目录 | 职责 |
|------|------|
| `components/video/` | 播放器、摘要面板、字幕面板、思维导图、QA 对话 |
| `components/knowledge/` | Wiki 图谱（Sigma.js）、知识树、QA 面板 |
| `components/curate/` | 精选卡片、Feed 列表、文章详情 |
| `components/ui/` | Shadcn/ui 基础组件库 |
| `lib/api/` | 按模块拆分的 API 客户端 |
| `hooks/` | 视频同步、Wiki 编译等业务 Hook |

### 数据模型

| 模型 | 关键字段 |
|------|---------|
| User | watcha_user_id, email, phone, is_admin, OAuth tokens |
| Video | url, platform, title, status (JSONB), show_name/host（播客） |
| Transcript | video_id, language, segments, segments_en |
| Summary | video_id, level (4 级), content, model_used |
| Mindmap | video_id, markdown, model_used |
| Article | user_id, kb_id, source_url, content, status |
| WikiPage | kb_id, title, slug, type, embedding (1024-dim), community_id |
| WikiRelation | from_page_id → to_page_id（有向图） |
| CurateChannel | name, slug, pick_count, is_active |
| CurateDailyPick | channel_id, pick_date, data (JSONB) |
| KnowledgeBase | user_id, name, is_default |

### Docker 服务拓扑

```
nginx (:80) → frontend (:3000) + backend (:8000)
backend → db (pg16) + redis + minio + rsshub
celery_{fast,pipeline,cron,curate,beat} → db + redis + bgutil-provider
```

---

## 代码护栏

下面是硬规则。违反任意一条都是 bug。

### 1. 后端异步护栏

- FastAPI 路由**必须** async，使用 `async with get_session()` 获取数据库会话
- Celery 任务**必须**同步，使用 `tasks/shared.py` 中的同步 DB/Redis 客户端
- **禁止**在 Celery 任务中使用 `asyncio.run()` 或 `await`
- **禁止**在 FastAPI 路由中使用同步阻塞调用（会阻塞事件循环）
- 长时间任务**必须**通过 Celery 队列分发，不在请求中同步执行

### 2. 状态追踪护栏

- 视频处理进度**必须**双写：Redis heartbeat（实时）+ DB status JSONB（持久）
- Redis key 格式：`video:{id}:heartbeat`，TTL 3600s
- status JSONB 结构：`{state, progress, message, error?}`
- state 枚举：`pending → processing → completed / failed`
- **禁止**只更新 Redis 不更新 DB，或反过来
- SSE 进度流从 Redis 读取，页面刷新后从 DB 恢复

### 3. LLM 调用护栏

- 所有 LLM 调用**必须**通过 LiteLLM，**禁止**直接调用 OpenAI SDK
- 摘要 prompt **必须**使用中文
- 4 级摘要有严格定义：express (5%) / highlight (30%) / detailed (60%) / full (90%)
- **禁止**在 prompt 中硬编码模型名，从配置读取
- LLM 调用失败**必须**有重试机制（至少 2 次），最终失败写入 status.error

### 4. 字幕获取护栏

- 优先级：yt-dlp 平台字幕 > youtube-transcript-api > Whisper ASR
- **禁止**对非 YouTube 平台使用 cookies 参数（已知 bug）
- ASR 配置项（WHISPER_API_BASE 等）缺失时**必须**优雅降级，不 crash
- 字幕格式统一为 `[{start, end, text}]` JSONB 数组
- 翻译结果存 `segments_en` 字段，不覆盖原始字幕

### 5. 前端状态护栏

- 服务端数据**必须**用 TanStack Query，**禁止**手动 useEffect + useState 管理
- 播放器同步状态**必须**用 Jotai atoms，**禁止**prop drilling
- **禁止** `any` 类型（TypeScript strict mode）
- API 错误**必须**在 UI 有明确反馈（toast 或错误状态），**禁止**静默吞掉
- 页面数据加载**必须**处理 loading / error / empty 三态

### 6. API 与认证护栏

- 认证走 OAuth2（观猹平台），JWT 存 Cookie（7 天）
- **禁止**在前端 localStorage 存 token
- 401 响应**必须**触发 token 刷新，刷新失败跳转登录
- 管理员端点**必须**同时验证 JWT + ADMIN_TOKEN
- **禁止** `print` / `logging.debug` 输出 token / password / API key
- URL 输入**必须**经过 `url_validator.py` 校验（SSRF 防护）

### 7. 数据库护栏

- 迁移**必须**用 Alembic，**禁止**手动 SQL 改 schema
- 新表/字段**必须**有对应的迁移文件，编号递增（当前到 029）
- **禁止**在迁移中 DROP 已有数据列（先标记废弃，下次迁移再删）
- pgvector embedding 维度固定 1024，**禁止**随意更改
- 唯一约束变更**必须**先确认线上数据是否有冲突

### 8. Docker 与部署护栏

- 服务间通信使用内部主机名（db / redis / minio），**禁止**用 localhost
- 内存限制已配置，新服务**必须**设定合理的 mem_limit
- 健康检查：backend 用 `/health`，db 用 `pg_isready`，redis 用 `redis-cli ping`
- **禁止**在 docker-compose.yml 中暴露不必要的端口到宿主机
- 前端构建产物用 standalone 模式，**禁止**引入 server action 以外的 Node.js runtime 依赖

---

## 重构规则

### 允许（无需事先讨论）

- 本地提取（一个函数拆成多个）
- 移除重复代码
- 命名清理
- 修复类型错误
- 替换不安全的空断言
- 单文件超 800 行的拆分
- 提取共享组件到 `components/ui/`
- 消灭硬编码字符串，替换为常量

### 谨慎（必须先列计划）

- 数据模型变更（需要迁移）
- API 接口签名变更（前后端联动）
- Celery 队列/任务重组
- 认证流程修改
- 共享服务重设计（`video_service` / `summary_service`）

### 除非明确需要，避免

- 引入新的 ORM 框架替代 SQLAlchemy
- 替换 Celery 为其他任务队列
- 前端状态管理库变更（Jotai → Zustand 等）
- 引入微服务拆分
- 多租户架构改造

---

## 功能完成检查清单

新功能 / 重要变更自检：

- [ ] 后端路由是 async？Celery 任务是同步？
- [ ] 视频处理任务有进度双写（Redis + DB）？
- [ ] LLM 调用通过 LiteLLM？有重试？
- [ ] 前端用 TanStack Query 管理服务端状态？
- [ ] 加载 / 错误 / 空状态都处理了？
- [ ] API 错误有 UI 反馈？
- [ ] 敏感信息没有 log 输出？
- [ ] 新数据库字段有 Alembic 迁移？
- [ ] Docker 服务有内存限制和健康检查？

## 文档维护

完成功能开发后，主动检查是否需要同步更新：

- `CLAUDE.md`：架构变化 / 新模块 / 新护栏
- `.env.example`：新增环境变量
- `docker-compose.yml`：新服务或配置变更
