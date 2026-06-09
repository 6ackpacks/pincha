#!/bin/bash
# 品猹开源仓库创建脚本
# 用途：从私有仓库创建干净的开源版本，移除敏感信息和内部文档

set -e  # 遇到错误立即退出

# 配置
PRIVATE_REPO="/Users/Admin/project/ping_cha"
PUBLIC_REPO="/Users/Admin/project/pingcha-public"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=========================================="
echo "品猹开源仓库创建工具"
echo "=========================================="
echo ""

# 检查源目录
if [ ! -d "$PRIVATE_REPO" ]; then
    echo "❌ 错误：找不到私有仓库目录 $PRIVATE_REPO"
    exit 1
fi

# 如果目标目录已存在，提示用户
if [ -d "$PUBLIC_REPO" ]; then
    echo "⚠️  目标目录已存在: $PUBLIC_REPO"
    read -p "是否删除并重新创建？(y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "操作已取消"
        exit 0
    fi
    echo "正在删除旧目录..."
    rm -rf "$PUBLIC_REPO"
fi

echo "📦 步骤 1/6: 创建目标目录..."
mkdir -p "$PUBLIC_REPO"

echo "📋 步骤 2/6: 复制代码文件（排除敏感信息）..."
cd "$PRIVATE_REPO"

# 使用 rsync 复制，排除敏感文件和目录
rsync -av --progress \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='.next' \
    --exclude='.venv' \
    --exclude='venv' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='cookies/' \
    --exclude='.DS_Store' \
    --exclude='*.pyc' \
    --exclude='*.log' \
    --exclude='.claude' \
    --exclude='SurfSense' \
    --exclude='backend/celerybeat-schedule*' \
    --exclude='frontend/tsconfig.tsbuildinfo' \
    --exclude='frontend/test-results/' \
    --exclude='frontend/playwright-report/' \
    --exclude='docs/remediation-plan.md' \
    ./ "$PUBLIC_REPO/"

echo "🔧 步骤 3/6: 修复配置文件..."

# 修复 backend/app/config.py - 移除硬编码的私有 API 网关
sed -i.bak 's|SUMMARY_API_BASE: str = "https://tokendance.agent-universe.cn/gateway/v1"|SUMMARY_API_BASE: str = ""|g' "$PUBLIC_REPO/backend/app/config.py"
rm -f "$PUBLIC_REPO/backend/app/config.py.bak"

# 修复 docker-compose.yml - 将硬编码代理改为环境变量
sed -i.bak 's|http://host.docker.internal:7897|${HTTP_PROXY:-}|g' "$PUBLIC_REPO/docker-compose.yml"
sed -i.bak 's|YOUTUBE_PROXY=http://host.docker.internal:7897|YOUTUBE_PROXY=${YOUTUBE_PROXY:-}|g' "$PUBLIC_REPO/docker-compose.yml"
rm -f "$PUBLIC_REPO/docker-compose.yml.bak"

# 修复 docker-compose.infra.yml（如果存在）
if [ -f "$PUBLIC_REPO/docker-compose.infra.yml" ]; then
    sed -i.bak 's|http://host.docker.internal:7897|${HTTP_PROXY:-}|g' "$PUBLIC_REPO/docker-compose.infra.yml"
    rm -f "$PUBLIC_REPO/docker-compose.infra.yml.bak"
fi

echo "📝 步骤 4/6: 更新文档..."

# 更新 README.md - 移除个人 GitHub 账号
sed -i.bak 's|@6ackpacks|your-organization|g' "$PUBLIC_REPO/README.md"
sed -i.bak 's|https://github.com/6ackpacks|https://github.com/your-org/pingcha|g' "$PUBLIC_REPO/README.md"
rm -f "$PUBLIC_REPO/README.md.bak"

# 在 .env.example 中添加代理配置说明
cat >> "$PUBLIC_REPO/.env.example" << 'EOF'

# 代理配置（可选，中国大陆访问 YouTube 需要）
# HTTP_PROXY=http://your-proxy-server:port
# HTTPS_PROXY=http://your-proxy-server:port
# YOUTUBE_PROXY=http://your-proxy-server:port
EOF

# 添加 OAuth 配置说明到 README
cat >> "$PUBLIC_REPO/README.md" << 'EOF'

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

EOF

echo "📄 步骤 5/6: 添加开源文件..."

# 添加 LICENSE (MIT)
cat > "$PUBLIC_REPO/LICENSE" << 'EOF'
MIT License

Copyright (c) 2026 Pingcha Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

# 添加 CONTRIBUTING.md
cat > "$PUBLIC_REPO/CONTRIBUTING.md" << 'EOF'
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
EOF

# 添加 .github/ISSUE_TEMPLATE/bug_report.md
mkdir -p "$PUBLIC_REPO/.github/ISSUE_TEMPLATE"
cat > "$PUBLIC_REPO/.github/ISSUE_TEMPLATE/bug_report.md" << 'EOF'
---
name: Bug 报告
about: 创建一个错误报告帮助我们改进
title: '[BUG] '
labels: bug
assignees: ''
---

## 描述
简洁清晰地描述这个 bug。

## 重现步骤
1. 进入 '...'
2. 点击 '...'
3. 执行 '...'
4. 看到错误

## 期望行为
描述你期望发生什么。

## 实际行为
描述实际发生了什么。

## 环境信息
- 操作系统: [例如 Ubuntu 22.04, macOS 14]
- Docker 版本: [例如 24.0.7]
- Docker Compose 版本: [例如 2.23.0]
- 浏览器: [例如 Chrome 120, Safari 17]

## 日志
如果可能，请提供相关的日志输出：
```
在此粘贴日志
```

## 截图
如果适用，添加截图以帮助解释你的问题。

## 额外信息
在这里添加关于问题的任何其他上下文。
EOF

cat > "$PUBLIC_REPO/.github/ISSUE_TEMPLATE/feature_request.md" << 'EOF'
---
name: 功能请求
about: 为这个项目提出一个新功能的想法
title: '[FEATURE] '
labels: enhancement
assignees: ''
---

## 功能描述
清晰简洁地描述你想要的功能。

## 问题场景
描述这个功能要解决什么问题。例如：当我想要 [...] 时，总是很困扰，因为 [...]

## 理想解决方案
清晰简洁地描述你希望发生什么。

## 替代方案
清晰简洁地描述你考虑过的任何替代方案或功能。

## 额外信息
在这里添加关于功能请求的任何其他上下文或截图。
EOF

echo "🔍 步骤 6/6: 初始化 Git 仓库..."
cd "$PUBLIC_REPO"
git init
git add .
git commit -m "Initial commit: 品猹开源版本

- 移除所有敏感信息和私有配置
- 添加 MIT LICENSE
- 添加贡献指南和 Issue 模板
- 更新文档以适配开源使用"

echo ""
echo "=========================================="
echo "✅ 开源仓库创建完成！"
echo "=========================================="
echo ""
echo "📁 位置: $PUBLIC_REPO"
echo ""
echo "接下来的步骤："
echo ""
echo "1️⃣  检查代码："
echo "   cd $PUBLIC_REPO"
echo "   git log --oneline"
echo "   cat README.md"
echo ""
echo "2️⃣  在 GitHub 上创建新仓库（建议命名为 'pingcha' 或 'pingcha-oss'）"
echo ""
echo "3️⃣  推送到 GitHub："
echo "   cd $PUBLIC_REPO"
echo "   git remote add origin https://github.com/YOUR_USERNAME/pingcha.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "4️⃣  更新仓库设置："
echo "   - 添加项目描述和标签"
echo "   - 启用 Issues 和 Discussions"
echo "   - 设置分支保护规则"
echo "   - 添加项目主题：ai, video-analysis, knowledge-management, fastapi, nextjs"
echo ""
echo "5️⃣  推广你的项目："
echo "   - 提交到 awesome-selfhosted"
echo "   - 发布到 Product Hunt"
echo "   - 在社交媒体分享"
echo ""
echo "⚠️  重要提醒："
echo "   - 仔细检查所有文件，确保没有遗漏敏感信息"
echo "   - 修改 README.md 中的 GitHub 链接（目前是占位符）"
echo "   - 考虑是否需要调整 LICENSE 年份和作者信息"
echo ""
