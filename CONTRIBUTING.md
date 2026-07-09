# 贡献指南

感谢你关注品猹。这个项目欢迎清晰、聚焦、可验证的贡献，包括 Bug 修复、文档改进、部署经验、测试补充、字幕来源适配、内容处理流程优化和前端体验改进。

## 开始之前

提交 Issue 或 Pull Request 前，请先搜索已有 Issue 和 PR，确认问题没有被重复报告或已经在处理中。如果你计划做较大的功能、架构调整或数据模型变更，请先开 Issue 说明背景、范围和方案，再开始实现。

## 可以贡献什么

- **Bug 修复**：复现稳定、范围明确、能说明修复前后行为差异的修复最容易合并。
- **文档改进**：部署说明、常见问题、环境变量说明、开发流程和故障排查都很有价值。
- **测试补充**：后端服务、API、前端组件、端到端流程和基础设施脚本都欢迎补测试。
- **字幕和内容来源适配**：新增 provider 或回退策略时，请说明适用场景、失败行为和配置方式。
- **知识库体验优化**：包括摘要、词条、图谱、问答、导出和阅读体验。
- **工程质量改进**：CI、lint、类型、性能、缓存和可观测性改进。

## 报告 Bug

请使用 Bug 模板，并尽量提供：

- 清晰的问题描述和实际影响。
- 最小复现步骤。
- 期望行为和实际行为。
- 操作系统、浏览器、Docker、Node.js、Python 等版本信息。
- 关键日志、截图或录屏。
- 是否使用了代理、Cookie、自定义模型服务或字幕服务。

请务必脱敏所有 Token、Cookie、账号、生产域名、私密链接和个人数据。

## 提交功能建议

功能建议应说明真实使用场景，而不仅是功能名称。建议包含：

- 你遇到的问题。
- 你期待的工作流。
- 为什么现有能力不够。
- 可接受的替代方案。
- 是否愿意参与实现、测试或文档编写。

## 本地开发

### 前置要求

- Python 3.11+
- Node.js 20+
- npm
- Docker 和 Docker Compose

### 启动基础设施

```bash
docker compose -f docker-compose.infra.yml up -d
```

### 后端

```bash
cd backend
pip install -r requirements.txt
pip install -r requirements-test.txt
pytest
```

### 前端

```bash
cd frontend
npm ci
npm run lint
npm run test
npm run build
```

### 端到端测试

```bash
cd frontend
npm run test:e2e
```

`tests/infrastructure/` 下的测试主要用于验证 Docker、nginx 和服务依赖。涉及真实媒体链接、第三方 API 或账号 Cookie 的检查不作为默认 CI 要求。

## 分支和提交

推荐从最新 `main` 创建短生命周期分支：

```bash
git checkout main
git pull
git checkout -b fix/short-description
```

分支命名建议：

- `fix/*`：Bug 修复
- `feature/*`：新功能
- `docs/*`：文档
- `chore/*`：工程配置或维护

提交信息建议使用 Conventional Commits：

```text
fix: handle transcript provider timeout
feat: add article source fallback
docs: clarify docker deployment
test: cover summary generation errors
```

## Pull Request 要求

PR 应保持范围聚焦。一个 PR 只解决一个清晰问题，避免把重构、格式化、功能开发和文档改动混在一起。

提交 PR 时请说明：

- 变更动机和用户影响。
- 主要实现方式。
- 已运行的测试或手动验证。
- 风险、兼容性和部署影响。
- 关联 Issue。

如果 PR 改动了数据库结构，请同时提交 Alembic migration，并说明升级路径。如果改动了环境变量，请同步更新 `.env.example` 和相关文档。

## 代码规范

### Python

- 遵循现有 FastAPI、SQLAlchemy、Celery 和服务层组织方式。
- 保持 I/O、业务逻辑、模型调用和数据访问边界清晰。
- 新增外部服务调用时要处理超时、错误、重试和降级行为。
- 运行后端测试前请安装 `requirements-test.txt`。

### TypeScript 和 React

- 遵循现有 Next.js App Router、组件拆分和 API client 模式。
- 对用户可见的异步状态提供 loading、empty、error 和 retry 路径。
- 不在组件中散落重复请求逻辑，优先复用 `lib/api`、hooks 和已有 UI 组件。
- 提交前运行 lint、测试和构建。

### 数据和迁移

- 所有 schema 变更必须有迁移。
- 迁移应可重复运行、可在空库和已有库上验证。
- 涉及数据回填时请说明耗时、失败恢复和是否需要人工执行。

## 安全和隐私

- 不要提交 `.env`、Token、Cookie、私钥、证书、服务账号文件或生产日志。
- Issue、PR、截图和测试数据必须脱敏。
- 单用户本地版本不建议直接暴露到公网。
- 发现安全问题时请按 [安全政策](SECURITY.md) 私下披露，不要公开创建 Issue。

## 行为准则

请遵守 [行为准则](CODE_OF_CONDUCT.md)。代码评审应聚焦事实、风险和改进方案，避免人身评价和无关争论。

## 获得帮助

如果你不确定某个改动是否适合提交，请先开 Issue 描述目标、约束和你已经尝试过的方案。维护者会尽量给出方向，再决定是否进入实现。
