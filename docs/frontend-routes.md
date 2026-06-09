# 品阅前端路由文档

> 最后更新: 2026-05-07 | 维护者: 开发团队

---

## 一、页面清单

| 路由 | 文件 | 说明 | 状态 |
|------|------|------|------|
| `/` | `app/page.tsx` | 发现/首页 — 视频/博客/播客提交入口 + 热门内容 | ✅ |
| `/landing` | `app/landing/page.tsx` | 公开介绍页（未登录用户） | ✅ |
| `/login` | `app/login/page.tsx` | OAuth 登录 | ✅ |
| `/videos` | `app/videos/page.tsx` | 视频列表（筛选/搜索/删除） | ✅ |
| `/videos/[id]` | `app/videos/[id]/page.tsx` | 视频/播客分析详情（播放器+字幕+总结+导图） | ✅ |
| `/videos/submit` | `app/videos/submit/page.tsx` | 视频提交页（独立页面） | ✅ |
| `/articles/[id]` | `app/articles/[id]/page.tsx` | 博客分析详情（原文+总结+导图） | ✅ |
| `/curate` | `app/curate/page.tsx` | 内容遴选（每日精选 feed） | ✅ |
| `/knowledge` | `app/knowledge/page.tsx` | 知识库（Wiki 词条+关系图谱） | ✅ |
| `/knowledge/[slug]` | `app/knowledge/[slug]/page.tsx` | 知识库词条详情（重定向到 `?slug=`） | ⚠️ |
| `/knowledge/ask` | `app/knowledge/ask/page.tsx` | 知识库问答 | ✅ |
| `/library` | `app/library/page.tsx` | 我的库（视频+订阅概览） | ✅ |
| `/library/videos` | `app/library/videos/page.tsx` | 全部视频列表 | ✅ |
| `/library/subscriptions` | `app/library/subscriptions/page.tsx` | 订阅管理 | ✅ |
| `/learn` | `app/learn/page.tsx` | 学习中心（KB 视频 + 对话入口） | ✅ |

---

## 二、侧边栏导航

```
发现        → /
遴选        → /curate
知识库      → /knowledge
Library     → /library
设置        → /settings (未实现, 标记 Soon)
```

---

## 三、核心用户流程

### 3.1 视频解析流程

```
/ (首页, 选"视频解析")
  → 输入 URL, 点击"解析"
  → submitVideo(url, platform)
  → router.push(`/videos/${video.id}`)
  → /videos/[id] (显示处理进度 → 完成后展示字幕/总结/导图)
```

### 3.2 博客解析流程

```
/ (首页, 选"博客解析")
  → 输入 URL, 点击"解析"
  → submitArticle(url)
  → router.push(`/articles/${article.id}`)
  → /articles/[id] (显示处理进度 → 完成后展示原文/总结/导图)
```

### 3.3 播客解析流程

```
/ (首页, 选"播客解析")
  → 输入 URL, 点击"解析"
  → submitVideo(url, "podcast")
  → router.push(`/videos/${video.id}`)
  → /videos/[id] (platform=podcast 时显示音频播放器+字幕+总结+导图)
```

### 3.4 内容遴选流程

```
/ (首页) → 点击频道卡片 → /curate?category={slug}
侧边栏 "遴选" → /curate
```

### 3.5 知识库流程

```
/videos/[id] → 点击"加入知识库" → 编译完成后 → /knowledge
/knowledge → 点击词条 → 右侧面板展示详情
/knowledge → 点击"向知识库提问" → /knowledge/ask
```

### 3.6 Library 流程

```
/library → 视频预览卡片 → /videos/[id]
/library → "查看全部" → /library/videos
/library → "管理订阅" → /library/subscriptions
```

---

## 四、页面间跳转关系

### 4.1 首页 `/` 出口

| 目标 | 触发方式 |
|------|---------|
| `/videos/{id}` | 提交视频/播客后跳转; 点击热门视频卡片 |
| `/articles/{id}` | 提交博客后跳转 |
| `/curate?category={slug}` | 点击频道卡片 |
| `/library` | "查看全部" 链接 (热门/播客/频道区域) |

### 4.2 视频详情 `/videos/[id]` 出口

| 目标 | 触发方式 |
|------|---------|
| `/videos` | 返回按钮 |
| `/knowledge` | "已在知识库 · 查看" 按钮 |
| 外部链接 | 原始视频 URL |

### 4.3 文章详情 `/articles/[id]` 出口

| 目标 | 触发方式 |
|------|---------|
| 上一页 | 返回按钮 (`router.back()`) |
| 外部链接 | 原文链接 |

### 4.4 知识库 `/knowledge` 出口

| 目标 | 触发方式 |
|------|---------|
| `/knowledge/ask` | "向知识库提问" 按钮 |
| `/knowledge?slug={slug}` | 点击词条 |

### 4.5 Library `/library` 出口

| 目标 | 触发方式 |
|------|---------|
| `/library/videos` | "查看全部" |
| `/library/subscriptions` | "管理订阅" |
| `/videos/{id}` | 点击视频卡片 |

### 4.6 Landing `/landing` 出口

| 目标 | 触发方式 |
|------|---------|
| `/login` | "开始使用" / "免费开始" CTA |
| `/about` | 导航栏 (**已失效，路由不存在**) |

---

## 五、Query 参数约定

| 页面 | 参数 | 用途 |
|------|------|------|
| `/curate` | `?category={slug}` | 筛选指定频道 |
| `/knowledge` | `?slug={slug}` | 选中指定词条 |
| `/knowledge/ask` | `?topic={text}` | 预填问题主题 |
| `/videos/[id]` | `?tab=chat` | 预选对话 Tab |

---

## 六、已知问题

| 问题 | 位置 | 严重度 | 建议 |
|------|------|--------|------|
| `/about` 路由不存在 | `/landing` 导航栏 | 🔴 高 | 删除链接或创建页面 |
| `/settings` 未实现 | 侧边栏 | 🟡 中 | 保持 Soon 标记或实现 |
| `/learn` 无侧边栏入口 | 侧边栏 | 🟡 中 | 考虑添加或合并到 Library |
| `/videos/submit` 与首页提交重复 | 首页 + 独立页 | 🟡 低 | 统一入口，考虑废弃独立页 |
| `/knowledge/[slug]` 重定向逻辑 | 知识库 | 🟡 低 | 改为直接渲染或保持重定向 |

---

## 七、内容类型与路由对应

| 内容类型 | 提交入口 | 详情页 | platform 值 |
|---------|---------|--------|------------|
| YouTube 视频 | `/` (视频解析) | `/videos/[id]` | `youtube` |
| Bilibili 视频 | `/` (视频解析) | `/videos/[id]` | `bilibili` |
| 播客 | `/` (播客解析) | `/videos/[id]` | `podcast` |
| 博客/文章 | `/` (博客解析) | `/articles/[id]` | — (独立模型) |

> 注意: 播客和视频共用 `/videos/[id]` 路由，通过 `platform === "podcast"` 条件渲染不同 UI（音频播放器 vs 视频播放器）。
> 博客使用独立的 `/articles/[id]` 路由和独立数据模型。

---

## 八、API 路由前缀

| 前缀 | 服务 | 说明 |
|------|------|------|
| `/api/v1/videos` | backend | 视频/播客 CRUD + 进度 |
| `/api/v1/articles` | backend | 博客 CRUD + 进度 |
| `/api/v1/curate` | backend | 订阅管理 |
| `/api/v1/wiki` | backend | 知识库 |
| `/api/v1/auth` | backend | 认证 |
| `/capi/api/v1/channels` | content-service (via nginx) | 内容聚合频道 |
