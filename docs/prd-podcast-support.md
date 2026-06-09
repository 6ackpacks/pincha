# PRD: 品猹播客解析支持

> 版本: 1.0 | 日期: 2026-04-27 | 状态: Draft

## 1. 背景与目标

品猹（Pingcha）目前支持 YouTube 视频的解析（转录 → 多级摘要 → 思维导图）。用户反馈希望对播客内容也能进行同样的知识提取。

播客与视频的核心区别：**没有画面，纯音频**。但知识提取流程（ASR 转写 → 摘要 → 导图）高度一致，现有 pipeline 约 90% 可复用。

### 目标

- P0：支持用户提交播客链接，自动完成音频转写 + 多级摘要 + 思维导图
- 覆盖国内外主流播客平台（喜马拉雅、Apple Podcasts、蜻蜓FM、SoundCloud、通用 RSS feed）
- 复用现有视频解析架构，最小化新增代码量

### 非目标

- 不做播客订阅/自动抓取新集（P1+）
- 不接入 Spotify（DRM 限制，技术上不可行）
- 不接入小宇宙（P1，需自建 fetcher）
- 不做播客搜索/发现功能

---

## 2. 平台支持范围

### P0（本期）

| 平台 | 接入方式 | 技术依赖 |
|------|---------|---------|
| 喜马拉雅 | yt-dlp 原生 extractor | yt-dlp |
| 蜻蜓FM | yt-dlp 原生 extractor | yt-dlp |
| Apple Podcasts | yt-dlp 原生 extractor | yt-dlp |
| SoundCloud | yt-dlp 原生 extractor | yt-dlp |
| 通用 RSS feed | feedparser 解析 + HTTP 下载 | feedparser, httpx |

### P1（后续）

| 平台 | 接入方式 | 备注 |
|------|---------|------|
| 小宇宙 | 自建 fetcher（参考 xyz-dl） | 无 yt-dlp extractor |

### Skip

| 平台 | 原因 |
|------|------|
| Spotify | DRM 保护，yt-dlp extractor 已损坏 |

---

## 3. 用户流程

### 3.1 提交播客

```
用户进入 /videos 列表页
  → 点击「提交播客」按钮（与「提交 YouTube」并列）
  → 跳转 /videos/submit?mode=podcast
  → 粘贴播客链接（喜马拉雅/Apple Podcasts/SoundCloud/蜻蜓FM/RSS feed URL）
  → 输入框下方显示支持平台列表提示
  → 点击「生成分析报告」
  → 后端自动识别 URL 类型，走对应通道
  → 跳转详情页，显示处理进度
```

### 3.2 URL 路由逻辑（后端）

用户提交 URL 时，`platform` 字段统一为 `"podcast"`。后端根据 URL 特征自动判断走哪条通道：

```
URL 匹配 ximalaya.com → yt-dlp
URL 匹配 podcasts.apple.com / apple.co → yt-dlp
URL 匹配 soundcloud.com → yt-dlp
URL 匹配 qingting.fm → yt-dlp
URL 以 .xml/.rss 结尾 或 Content-Type 为 application/rss+xml → feedparser
其他 → 先尝试 yt-dlp，失败后尝试 feedparser
```

### 3.3 RSS feed 处理规则

- 解析 RSS feed XML，提取最新一集（第一个 `<item>`）
- 从 `<enclosure>` 标签获取音频文件 URL
- 从 feed 元数据提取：节目名（show_name）、主播（host）、单集标题、封面图、描述
- 不做批量处理，不做订阅

### 3.4 查看播客详情

```
用户进入 /videos/[id]
  → 系统根据 platform === "podcast" 条件渲染
  → 显示音频播放器（替代视频播放器）+ 播客封面图
  → 字幕同步、摘要 tab、思维导图、Q&A 全部复用现有逻辑
  → 如有说话人分离数据，转录文本标注说话人
```

---

## 4. 技术方案

### 4.1 数据模型变更

#### Video 表新增字段（需 alembic migration）

```python
# 新增可选字段
show_name: String(500) | None    # 播客节目名
host: String(200) | None         # 主播名
description: Text | None         # 单集描述
```

#### platform 字段扩展

```python
# VideoCreate schema
platform: Literal["youtube", "bilibili", "podcast"]
```

> Bilibili 保留在 schema 中但前端隐藏入口。

#### Transcript segments 格式扩展

```json
// 现有格式
{"start": 0.0, "end": 5.2, "text": "大家好"}

// 播客格式（有说话人分离时）
{"start": 0.0, "end": 5.2, "text": "大家好", "speaker": "speaker0"}
```

> speaker 字段可选。YouTube 转录没有此字段，前端判断有就显示，没有就不显示。无需 migration，JSONB 天然灵活。

### 4.2 后端新增模块

#### 4.2.1 讯飞 ASR 服务 — `backend/app/services/xfyun_asr.py`

- 调用讯飞「录音文件识别」异步 API
- 鉴权：HMAC-SHA1 签名（`XFYUN_APP_ID` + `XFYUN_API_SECRET`）
- 流程：上传音频 → 获取 task_id → 轮询结果（间隔 5 秒，超时 30 分钟）
- P0 开启说话人分离（diarization）
- 返回格式：`[{start, end, text, speaker}]`

环境变量：

```
XFYUN_APP_ID=
XFYUN_API_SECRET=
```

#### 4.2.2 RSS feed 解析器 — `backend/app/services/rss_service.py`

- 使用 `feedparser` 库解析 RSS XML
- 提取最新一集的：标题、音频 URL（enclosure）、封面图、节目名、主播、描述、时长
- 音频下载：先尝试 yt-dlp，失败后 fallback 到 httpx 直接 HTTP 下载
- 下载后调用现有 ffmpeg 转换逻辑（16kHz mono WAV）

新增依赖：

```
feedparser>=6.0
```

#### 4.2.3 subtitle_service.py 修改

ASR 路由按 platform 分流：

```python
def get_transcript_segments(url, platform, on_progress):
    if platform == "youtube":
        # 现有流程不变：Supadata → youtube-transcript-api → yt-dlp → Whisper
        ...
    elif platform == "podcast":
        # 播客专用路径
        # 1. 尝试 yt-dlp 平台字幕（极少数播客有）
        # 2. 下载音频（yt-dlp 或 HTTP 直接下载）
        # 3. 讯飞 ASR 转写（带说话人分离）
        ...
```

关键修复：
- 移除 cookies 守卫对非 YouTube 平台的误拦（现有 bug）
- Whisper API 保留为 YouTube 的 fallback，不再用于播客

### 4.3 前端变更

#### 4.3.1 视频列表页 `/videos/page.tsx`

- 顶部按钮区域：「提交 YouTube」+「提交播客」两个按钮并列
- 「提交 YouTube」→ `/videos/submit?mode=youtube`
- 「提交播客」→ `/videos/submit?mode=podcast`
- 视频卡片：根据 `platform` 显示不同 badge（Y = YouTube, 🎙️ = 播客）
- 隐藏 Bilibili 相关 UI（保留代码）

#### 4.3.2 提交页 `/videos/submit/page.tsx`

- 读取 `?mode=youtube|podcast` query param，默认 youtube
- YouTube 模式：现有逻辑不变（隐藏 Bilibili 选项）
- Podcast 模式：
  - 标题改为「提交播客」
  - placeholder 改为播客 URL 示例
  - 输入框下方提示支持的平台列表（喜马拉雅 / Apple Podcasts / SoundCloud / 蜻蜓FM / RSS feed）
  - 提交时 `platform = "podcast"`
- 顶部 tab 切换 YouTube / 播客模式

#### 4.3.3 详情页 `/videos/[id]/page.tsx`

- `platform === "podcast"` 时：
  - 替换视频播放器为音频播放器组件（简单进度条 + 播客封面图）
  - 显示播客元数据（节目名、主播、描述）
  - 转录文本有 `speaker` 字段时，标注说话人标签
- 其余（字幕同步、摘要 tab、思维导图、Q&A）全部复用

#### 4.3.4 新增组件 — 音频播放器

- `frontend/components/audio/audio-player.tsx`
- 基于 HTML5 `<audio>` 元素
- 功能：播放/暂停、进度条、时间显示、播放速度调节
- 通过 Jotai atom 与字幕同步（复用现有 `atoms/player.ts` 的 currentTime 机制）
- 显示播客封面图作为背景

#### 4.3.5 侧边栏导航

- 「播客」导航项移除 `soon: true` 标记
- 点击跳转到 `/videos?filter=podcast`（或直接跳 `/videos/submit?mode=podcast`）

### 4.4 Celery pipeline

现有 `process_video` task 无需修改 — 它是纯编排器，不含平台特定逻辑。播客和视频走同一条 pipeline：

```
submit → process_video → process_subtitles → generate_summaries → generate_mindmap → done
```

唯一区别在 `process_subtitles` 内部：根据 platform 走不同的 ASR 路径。

---

## 5. 接口变更

### 5.1 POST /api/v1/videos

请求体：

```json
{
  "url": "https://www.ximalaya.com/sound/123456",
  "platform": "podcast"
}
```

> `platform` 新增 `"podcast"` 可选值。

响应不变。

### 5.2 VideoResponse 扩展

```json
{
  "id": "uuid",
  "url": "...",
  "platform": "podcast",
  "title": "EP42: AI Agent 的未来",
  "show_name": "硅谷早知道",
  "host": "张三",
  "description": "本期我们聊聊...",
  "thumbnail_url": "...",
  "duration": "01:23:45",
  "status": {"state": "done", "progress": 100, "message": "完成"}
}
```

> `show_name`、`host`、`description` 为新增可选字段，仅播客有值。

---

## 6. 配置变更

### 新增环境变量

```env
# 讯飞语音转写
XFYUN_APP_ID=
XFYUN_API_SECRET=
```

### config.py 新增

```python
XFYUN_APP_ID: str = ""
XFYUN_API_SECRET: str = ""
```

### 新增 Python 依赖

```
feedparser>=6.0
```

---

## 7. 数据库迁移

```
alembic revision --autogenerate -m "add podcast fields to videos"
```

新增字段：
- `videos.show_name` — String(500), nullable
- `videos.host` — String(200), nullable
- `videos.description` — Text, nullable

---

## 8. 实现优先级

### Phase 1: 后端基础（可独立测试）

1. 数据库迁移 — 加 podcast 字段
2. Schema 更新 — `platform` 加 `"podcast"`
3. 讯飞 ASR 服务 — `xfyun_asr.py`
4. RSS feed 解析器 — `rss_service.py`
5. `subtitle_service.py` 改造 — 按 platform 分流 ASR 路径 + 修复 cookies 守卫 bug

### Phase 2: 前端改造

6. 提交页改造 — tab 切换 + 播客模式
7. 视频列表页 — 双按钮入口 + 播客 badge
8. 音频播放器组件 — `audio-player.tsx`
9. 详情页改造 — 条件渲染音频播放器 + 说话人标签
10. 侧边栏 — 播客导航项激活

### Phase 3: 收尾

11. `.env.example` 更新
12. Bilibili 前端入口隐藏
13. 端到端测试

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 讯飞 API 鉴权复杂（HMAC-SHA1 签名） | 集成耗时 | 参考官方 Python demo，签名逻辑封装一次 |
| 长播客（>2h）讯飞处理超时 | 转写失败 | 设置 30 分钟轮询超时，超时后标记失败并提示用户 |
| RSS feed 格式不标准 | 解析失败 | feedparser 容错性强，加 try-catch 兜底 |
| yt-dlp 对某些播客平台支持不稳定 | 下载失败 | fallback 到 HTTP 直接下载（RSS 通道） |
| 播客音频文件较大（100MB+） | 下载/转换慢 | Celery pipeline 已有超时机制（1h hard limit） |

---

## 10. 成功指标

- 用户能成功提交喜马拉雅、Apple Podcasts、SoundCloud、蜻蜓FM 单集链接并获得完整分析
- 用户能提交 RSS feed URL 并获得最新一集的分析
- 播客转录准确率 ≥ 95%（中文普通话内容）
- 播客处理时间 ≤ 15 分钟（1 小时音频）
- 说话人分离正确标注 ≥ 2 个说话人的播客
