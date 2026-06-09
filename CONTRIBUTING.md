# 贡献指南

感谢你对品猹项目的关注！我们欢迎各种形式的贡献。

## 如何贡献

### 报告 Bug
- 使用 GitHub Issues 报告问题
- 提供清晰的重现步骤
- 说明你的运行环境（操作系统、Docker 版本等）

### 提交功能请求
- 先检查是否已有类似的 Issue
- 清楚描述你的需求和使用场景
- 如果可能，提供设计方案

### 提交代码
1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交改动 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 开发规范

### 代码风格
- **Python**: 遵循 PEP 8，使用 Black 格式化
- **TypeScript**: 遵循 ESLint 规则
- **提交信息**: 使用 Conventional Commits 格式

### 测试
- 后端：运行 `pytest backend/tests/`
- 前端：运行 `npm run test` 和 `npm run lint`

### 分支策略
- `main` - 稳定版本
- `dev` - 开发分支
- `feature/*` - 新功能
- `fix/*` - Bug 修复

## 行为准则

请保持尊重和建设性的交流。我们致力于营造一个开放、友好的社区环境。

## 问题？

如有疑问，欢迎在 GitHub Issues 中提问，或发送邮件至项目维护者。
