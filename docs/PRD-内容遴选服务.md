# PRD：品猹内容遴选服务

> **版本**：v1.0
> **日期**：2026-04-21
> **作者**：品猹产品团队
> **状态**：待评审

---

## 1. 背景与目标

### 1.1 背景

品猹（Pingcha）是一个 AI 驱动的视频分析平台，当前核心功能围绕"用户主动粘贴链接 → AI 分析视频内容"展开。但用户面临一个上游问题：**不知道今天有什么值得看的内容**。

市场上已有大量信息聚合工具（今日热榜、Readhub、RSSHub 等），但它们只做"信息搬运"，缺乏深度清洗、智能筛选和结构化摘要能力。

### 1.2 目标

构建一个**独立部署的内容聚合服务**，每日从十余个信息源中自动发现、筛选、清洗高质量内容，通过 REST API 向品猹平台供数。品猹前端只负责展示和用户交互。

### 1.3 核心价值

- **用户价值**：每天早上 8 点打开品猹，即可看到各领域最值得关注的 5 条精选内容，无需自己刷各平台
- **平台价值**：提升用户打开频次和留存率；视频类内容可直接导入分析 pipeline，形成闭环
- **技术价值**：内容服务独立部署，与品猹主系统解耦，可独立迭代和扩展

---

## 2. 用户场景

### 场景 A：每日推荐阅读

> 小张是一名 AI 工程师，每天早上打开品猹，看到已订阅的"全网最新 AI 资讯"频道推送了 5 条精选。他花 10 分钟浏览中文摘要，对其中一篇 OpenAI 的论文解读感兴趣，点击跳转原文深度阅读。

### 场景 B：自动发现待分析视频

> 小李订阅了"每日精选 AI 视频"频道，今天推荐了一个 YouTube 上的 AI 教程。他点击"加入分析"，品猹自动开始视频分析流程，生成摘要、字幕和思维导图。

---

## 3. 系统架构

### 3.1 整体架构

```
独立服务器（内容聚合服务）                 品猹服务器
┌─────────────────────────┐          ┌────────────────────┐
│                         │          │                    │
│  RSSHub (Docker, :1200) │          │  品猹 FastAPI 后端   │
│  ↓ JSON Feed            │          │  ↓                  │
│                         │          │  品猹 Next.js 前端   │
│  聚合服务 (FastAPI)      │──REST──→ │  - 频道订阅管理      │
│  ↓                      │  API    │  - 每日精选展示      │
│  Celery Workers         │          │  - 跳转原文/分析     │
│  - 全文抓取              │          │                    │
│  - LLM 摘要 (30-50%)    │          └────────────────────┘
│  - 中文翻译              │
│  - 热度 + LLM 打分      │
│  - Top 5 筛选            │
│  ↓                      │
│  PostgreSQL / SQLite    │
│                         │
└─────────────────────────┘
```

### 3.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 数据采集 | RSSHub (自建实例) | 覆盖全部目标平台，零成本，JSON Feed 输出 |
| 业务逻辑 | FastAPI (Python) | 与品猹后端技术栈一致，团队熟悉 |
| 异步任务 | Celery + Redis | 全文抓取和 LLM 处理为耗时操作 |
| LLM 调用 | LiteLLM | 统一接口，可切换 DeepSeek/GPT/Claude |
| 全文提取 | readability-lxml / trafilatura | 从原文 URL 提取正文内容 |
| 数据存储 | PostgreSQL | 结构化存储每日精选数据 |
| 部署 | Docker Compose | 一键部署，含 RSSHub + 聚合服务 + Redis + DB |

---

## 4. 频道设计

### 4.1 频道列表（v1.0 共 5 个）

| # | 频道 ID | 频道名称 | 每日推送数 | 内容类型 |
|---|---------|---------|-----------|---------|
| 1 | `ai_video` | 每日精选 AI 视频 | 5 条 | video / podcast |
| 2 | `product_launch` | 每日产品上新 | 5 条 | article |
| 3 | `ai_news` | 全网最新 AI 资讯 | 5 条 | article |
| 4 | `github_trending` | GitHub 开源精选 | 5 条 | article |
| 5 | `deep_biz` | 深度商业长文 | 5 条 | article |

### 4.2 各频道数据源

#### 频道 1：每日精选 AI 视频

| 数据源 | RSSHub 路由 | 说明 |
|--------|------------|------|
| YouTube AI 频道 | `/youtube/channel/:id` | Two Minute Papers, Fireship, 3Blue1Brown 等 |
| Bilibili AI UP主 | `/bilibili/user/video/:uid` | 预设优质 AI UP主列表 |
| Bilibili 热搜 | `/bilibili/hot-search` | 筛选 AI 相关话题 |
| 小宇宙 AI 播客 | `/xiaoyuzhou/podcast/:id` | 预设 AI 播客列表 |

#### 频道 2：每日产品上新

| 数据源 | RSSHub 路由 | 说明 |
|--------|------------|------|
| ProductHunt | `/producthunt/today` | 每日新品 |
| 36氪新产品 | `/36kr/newsflashes` | 筛选产品上线类快讯 |
| 少数派新工具 | `/sspai/tag/新玩意` | 效率工具推荐 |

#### 频道 3：全网最新 AI 资讯

| 数据源 | RSSHub 路由 | 说明 |
|--------|------------|------|
| 机器之心 | `/jiqizhixin/daily` | 国内最权威 AI 媒体 |
| 量子位 | `/qbitai/category/资讯` | AI 行业报道 |
| Hacker News | `/hackernews/best` | 过滤 AI 关键词 |
| TechCrunch AI | `/techcrunch/tag/artificial-intelligence` | 海外 AI 新闻 |
| InfoQ AI | `/infoq/topic/1` | 技术实践 |

#### 频道 4：GitHub 开源精选

| 数据源 | RSSHub 路由 | 说明 |
|--------|------------|------|
| GitHub Trending | `/github/trending/daily/python` | 每日趋势项目 |
| GitHub Trending | `/github/trending/daily/typescript` | 前端/全栈项目 |
| HN Show | `/hackernews/show` | Show HN 项目展示 |

#### 频道 5：深度商业长文

| 数据源 | RSSHub 路由 | 说明 |
|--------|------------|------|
| 虎嗅深度 | `/huxiu/article` | 科技行业深度分析 |
| 少数派 Matrix | `/sspai/matrix` | 高质量 UGC 长文 |
| 36氪深度 | `/36kr/news/latest` | 商业/创投报道 |
| Readhub | `/readhub/category/topic` | 科技商业聚合 |
| AI 个人媒体 | 自定义 RSS URL | 知名 AI 博主/公众号（通过 RSS 订阅） |

---

## 5. 数据处理 Pipeline

### 5.1 处理流程

```
每天凌晨 5:00 定时触发（预留 3 小时处理时间，确保 8:00 前完成）

Step 1: 数据采集
  ├── RSSHub 拉取各频道所有数据源的 JSON Feed
  ├── 每个频道约 50-100 条原始条目
  └── 记录：title, url, source, published_at, type

Step 2: 去重
  ├── 按 URL 去重（跨源相同文章）
  ├── 按标题相似度去重（同一事件不同报道）
  └── 排除已推送过的历史内容

Step 3: 热度初筛
  ├── 各平台排名/热度数据作为初始权重
  ├── 按热度排序，每频道取 Top 20
  └── 剩余内容归档但不进入后续流程

Step 4: 全文抓取
  ├── 对 Top 20 的原文 URL 进行全文提取
  ├── 使用 trafilatura / readability-lxml
  ├── 提取：正文文本、封面图、作者、发布时间
  └── 抓取失败的条目降权但不剔除

Step 5: LLM 处理（每频道 20 条，共约 100 条）
  ├── 英文内容 → 翻译成中文
  ├── 生成详细摘要（30-50% 原文内容量）
  ├── 质量打分（0-100）
  │   评分维度：信息密度、时效性、话题相关度、原创性
  └── 分类标签（可选，用于前端筛选）

Step 6: 精选输出
  ├── 每频道按 LLM 分数排序，取 Top 5
  ├── 写入数据库，标记为当日精选
  └── 生成 API 可查询的结构化数据
```

### 5.2 异常处理

| 异常场景 | 处理策略 |
|---------|---------|
| RSSHub 某个源拉取失败 | 跳过该源，用其他源补充 |
| 全文抓取失败 | 使用 RSS 自带的 summary 替代 |
| LLM 调用超时/失败 | 重试 3 次，仍失败则使用原文前 500 字作为摘要 |
| 当日某频道不足 5 条 | 按实际数量推送，不用垃圾内容凑数 |
| Pipeline 在 8:00 前未完成 | 推送上一次成功的结果，后台继续处理 |

---

## 6. API 设计

### 6.1 接口列表

#### GET `/api/v1/channels`

返回所有可订阅频道列表。

```json
{
  "channels": [
    {
      "id": "ai_video",
      "name": "每日精选 AI 视频",
      "description": "每日推送最佳 AI 播客、教学视频和新闻视频",
      "icon": "video",
      "item_count": 5
    }
  ]
}
```

#### GET `/api/v1/channels/{channel_id}/today`

返回指定频道当日精选内容。

```json
{
  "channel": "ai_news",
  "date": "2026-04-21",
  "items": [
    {
      "id": "uuid",
      "title": "GPT-5 发布：多模态推理能力大幅提升",
      "url": "https://原文链接",
      "source": "机器之心",
      "type": "article",
      "thumbnail": "https://封面图URL",
      "summary": "OpenAI 于今日正式发布 GPT-5，这是自 GPT-4 以来最大的一次模型升级。新模型在多模态推理方面取得了显著突破，能够同时处理文本、图像、音频和视频输入，并在复杂推理任务上相比前代提升了 40%。GPT-5 引入了全新的 Chain-of-Thought 架构...(约 1000-1500 字的详细摘要)",
      "score": 95,
      "published_at": "2026-04-21T08:30:00Z"
    }
  ]
}
```

#### GET `/api/v1/channels/{channel_id}/history?date=2026-04-20`

返回指定频道历史日期的精选内容（格式同上）。

#### GET `/api/v1/feed?channels=ai_news,ai_video`

返回多个频道的聚合 Feed（品猹首页展示用）。

---

## 7. 品猹前端展示

### 7.1 用户流程

```
用户首次进入"内容遴选"模块
  → 展示 5 个频道卡片，用户勾选订阅（至少 1 个）
  → 保存订阅偏好

每日访问
  → 展示已订阅频道的当日精选
  → 每个频道显示 5 条内容卡片
  → 卡片包含：标题、来源、封面图、摘要预览（前 2-3 行）

用户点击某条内容
  → 展开完整摘要（30-50% 详细内容）
  → 底部显示"阅读原文"按钮 → 跳转原文链接
  → 如果 type=video → 额外显示"加入分析"按钮 → 进入品猹视频分析 pipeline
  → 显示"加入知识库"按钮 → 将内容存入用户的知识库
```

### 7.2 页面结构

```
┌──────────────────────────────────────────┐
│  内容遴选    2026年4月21日    管理订阅 >   │
├──────────────────────────────────────────┤
│                                          │
│  🎬 每日精选 AI 视频                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│
│  │ 卡1  │ │ 卡2  │ │ 卡3  │ │ 卡4  │ │ 卡5  ││
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘│
│                                          │
│  📰 全网最新 AI 资讯                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│
│  │ 卡1  │ │ 卡2  │ │ 卡3  │ │ 卡4  │ │ 卡5  ││
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘│
│                                          │
│  ...（其他已订阅频道）                     │
└──────────────────────────────────────────┘
```

---

## 8. 部署方案

### 8.1 独立服务器 Docker Compose

```yaml
# 内容聚合服务 docker-compose.yml
services:
  rsshub:
    image: diygod/rsshub:latest
    ports:
      - "1200:1200"
    environment:
      - PROXY_URI=  # 如需代理海外源
    restart: always

  redis:
    image: redis:7-alpine
    restart: always

  aggregator:
    build: .
    depends_on:
      - rsshub
      - redis
      - db
    environment:
      - RSSHUB_URL=http://rsshub:1200
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://...
      - LITELLM_API_KEY=...
    restart: always

  celery_worker:
    build: .
    command: celery -A app.tasks worker -Q content -c 4
    depends_on:
      - redis
      - db
    restart: always

  celery_beat:
    build: .
    command: celery -A app.tasks beat
    depends_on:
      - redis
    restart: always

  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: always

volumes:
  pgdata:
```

### 8.2 服务器配置要求

| 项目 | 最低配置 | 推荐配置 |
|------|---------|---------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 40 GB SSD | 80 GB SSD |
| 带宽 | 5 Mbps | 10 Mbps |
| 操作系统 | Ubuntu 22.04 | Ubuntu 22.04 |

---

## 9. 成本估算

### 9.1 开发成本

| 阶段 | 工作内容 | 预估时间 |
|------|---------|---------|
| Phase 1 | RSSHub 部署 + 数据源配置 | 1 天 |
| Phase 2 | 聚合服务核心 Pipeline（采集→去重→热度筛选） | 3 天 |
| Phase 3 | 全文抓取 + LLM 摘要/翻译/打分 | 3 天 |
| Phase 4 | REST API + 数据库设计 | 2 天 |
| Phase 5 | 品猹前端"内容遴选"模块 | 3-5 天 |
| Phase 6 | 联调 + 测试 + 部署 | 2 天 |
| **合计** | | **约 2-3 周** |

### 9.2 运营成本（月）

| 项目 | 费用 |
|------|------|
| 云服务器（2核4G） | ¥50-100/月 |
| LLM API（每天约 100 条处理） | ¥150-450/月（约 ¥5-15/天） |
| 代理线路（YouTube 等海外源） | ¥30-50/月 |
| **合计** | **约 ¥230-600/月** |

---

## 10. 里程碑计划

| 里程碑 | 交付物 | 预计时间 |
|--------|--------|---------|
| M1：数据通路打通 | RSSHub 部署 + 3 个频道数据可拉取 | 第 1 周 |
| M2：Pipeline 跑通 | 全文抓取 + LLM 摘要 + 打分筛选 | 第 2 周 |
| M3：API 上线 | REST API 可供品猹调用 | 第 2 周末 |
| M4：前端上线 | 品猹"内容遴选"模块可用 | 第 3 周 |
| M5：全量频道 | 5 个频道全部上线 | 第 3 周末 |

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| RSSHub 路由失效 | 某个数据源断供 | 每个频道配置 3+ 数据源互为备份；监控告警 |
| 全文抓取被反爬 | 无法获取正文 | 降级使用 RSS 自带摘要；轮换 User-Agent |
| LLM 成本超预期 | 月费用过高 | 使用 DeepSeek 等低成本模型；减少处理量 |
| 海外源需要代理 | YouTube/HN 等无法访问 | 配置 HTTP 代理；RSSHub 支持代理配置 |
| 内容质量不稳定 | 用户体验波动 | 持续优化 LLM prompt；人工抽检调优 |

---

## 12. 未来扩展

- **v1.1**：支持用户自定义 RSS 源，创建个人频道
- **v1.2**：基于用户阅读行为的个性化推荐
- **v1.3**：接入更多频道（加密/Web3、学术论文、设计灵感等）
- **v2.0**：内容社区化——用户可分享、评论、收藏精选内容
