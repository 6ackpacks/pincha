# 品猹开源发布指南

本文档指导你完成从私有仓库到开源仓库的完整流程。

---

## 快速开始

### 方式 1：自动化脚本（推荐）

```bash
# 在当前私有仓库目录下运行
bash create-opensource-repo.sh
```

脚本会自动：
- ✅ 复制所有代码文件到 `/Users/Admin/project/pingcha-public`
- ✅ 排除敏感文件（.env, cookies/, .git, node_modules 等）
- ✅ 修复硬编码的私有配置
- ✅ 添加 LICENSE 和贡献指南
- ✅ 初始化干净的 Git 仓库

### 方式 2：手动操作

如果你想更精细地控制流程，参考下面的详细步骤。

---

## 详细步骤

### 第 1 步：运行创建脚本

```bash
cd /Users/Admin/project/ping_cha
bash create-opensource-repo.sh
```

**预计时间：** 2-3 分钟

**输出示例：**
```
==========================================
品猹开源仓库创建工具
==========================================

📦 步骤 1/6: 创建目标目录...
📋 步骤 2/6: 复制代码文件...
🔧 步骤 3/6: 修复配置文件...
📝 步骤 4/6: 更新文档...
📄 步骤 5/6: 添加开源文件...
🔍 步骤 6/6: 初始化 Git 仓库...

✅ 开源仓库创建完成！
```

---

### 第 2 步：检查生成的代码

```bash
cd /Users/Admin/project/pingcha-public

# 查看文件结构
ls -la

# 查看 Git 历史（应该只有一个干净的 commit）
git log --oneline

# 检查关键文件
cat LICENSE
cat CONTRIBUTING.md
cat README.md
```

#### 关键检查项：

**A. 检查 backend/app/config.py**
```bash
grep "tokendance" backend/app/config.py
# 应该返回空（没有私有 API 网关）
```

**B. 检查 docker-compose.yml**
```bash
grep "7897" docker-compose.yml
# 应该返回空（没有硬编码代理）

grep "HTTP_PROXY" docker-compose.yml
# 应该看到 ${HTTP_PROXY:-} 这样的环境变量
```

**C. 检查是否有敏感信息**
```bash
# 不应该有真实的 .env 文件
ls -la | grep "\.env$"

# 不应该有 cookies 目录
ls -la | grep "cookies"

# README 不应该有个人 GitHub 账号
grep "6ackpacks" README.md
# 应该返回空或已替换为 your-organization
```

---

### 第 3 步：在 GitHub 创建新仓库

#### 3.1 登录 GitHub
访问 https://github.com/new

#### 3.2 填写仓库信息

**仓库名称：** `pingcha` 或 `pingcha-oss`

**描述：**
```
AI-powered content learning platform. Transform videos, podcasts, and articles into searchable knowledge with 4-level summaries, mindmaps, and RAG-powered Q&A. 把内容，品成知识。
```

**可见性：** ✅ Public

**其他选项：**
- ❌ 不要勾选 "Add a README file"（我们已经有了）
- ❌ 不要添加 .gitignore（我们已经有了）
- ❌ 不要选择 License（我们已经添加了 MIT）

点击 **Create repository**

#### 3.3 记下仓库 URL
```
https://github.com/YOUR_USERNAME/pingcha.git
```

---

### 第 4 步：推送到 GitHub

```bash
cd /Users/Admin/project/pingcha-public

# 添加远程仓库（替换 YOUR_USERNAME）
git remote add origin https://github.com/YOUR_USERNAME/pingcha.git

# 确认远程仓库
git remote -v

# 推送代码
git branch -M main
git push -u origin main
```

**如果遇到认证问题：**
```bash
# 使用 GitHub CLI（推荐）
gh auth login

# 或使用 Personal Access Token
# 在 GitHub Settings → Developer settings → Personal access tokens 创建 token
# 然后使用 token 作为密码推送
```

---

### 第 5 步：配置 GitHub 仓库

#### 5.1 设置基本信息

在 GitHub 仓库页面点击 **Settings**：

**About 部分（右上角）：**
- Website: `https://yourproject.com`（如果有）
- Topics（标签）：
  - `ai`
  - `video-analysis`
  - `knowledge-management`
  - `fastapi`
  - `nextjs`
  - `rag`
  - `self-hosted`
  - `chinese`

#### 5.2 启用功能

在 **Settings → General → Features**：
- ✅ Issues
- ✅ Discussions（推荐，用于社区交流）
- ✅ Projects（可选）
- ✅ Wiki（可选）

#### 5.3 分支保护

在 **Settings → Branches**：
- 点击 **Add branch protection rule**
- Branch name pattern: `main`
- 勾选：
  - ✅ Require a pull request before merging
  - ✅ Require approvals (至少 1 个)
  - ✅ Require status checks to pass before merging（如果有 CI/CD）

---

### 第 6 步：完善 GitHub 展示

#### 6.1 更新 README.md

在开源仓库中修改：

```bash
cd /Users/Admin/project/pingcha-public

# 替换占位符
sed -i '' 's|your-organization|YOUR_GITHUB_USERNAME|g' README.md
sed -i '' 's|your-org|YOUR_GITHUB_USERNAME|g' README.md

# 提交改动
git add README.md
git commit -m "docs: update GitHub links"
git push
```

#### 6.2 添加徽章（可选但推荐）

在 README.md 顶部添加：

```markdown
# 品猹 (Pingcha)

[![GitHub stars](https://img.shields.io/github/stars/YOUR_USERNAME/pingcha?style=social)](https://github.com/YOUR_USERNAME/pingcha)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://www.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
```

#### 6.3 创建 Social Preview 图片

在 **Settings → General → Social preview**：
- 上传一张 1280x640 像素的预览图
- 建议包含项目 Logo 和简短说明

---

## 推广你的项目

### 1. 提交到 Awesome 列表

- [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
- [awesome-ai](https://github.com/amusi/awesome-ai-awesomeness)
- [awesome-fastapi](https://github.com/mjhea0/awesome-fastapi)

### 2. 社交媒体

**Twitter/X：**
```
🚀 开源了我的 AI 内容学习平台 - 品猹（Pingcha）！

✨ 特性：
- 视频/播客/文章 AI 解析
- 4 级智能摘要
- 思维导图自动生成
- RAG 知识库问答

🛠️ 技术栈：FastAPI + Next.js 15 + PostgreSQL + pgvector

GitHub: https://github.com/YOUR_USERNAME/pingcha

#AI #OpenSource #KnowledgeManagement
```

**Reddit：**
- r/selfhosted
- r/MachineLearning
- r/opensource

**Hacker News：**
- Show HN: 品猹 - AI-powered content learning platform

### 3. Product Hunt

准备发布材料：
- 产品截图（至少 3 张）
- 演示视频（1-2 分钟）
- Logo（240x240 像素）
- Tagline（60 字符内）："Transform videos and articles into searchable knowledge"

---

## 维护双仓库策略

### 同步流程

**私有仓库 → 开源仓库（功能更新）：**

```bash
# 在私有仓库
cd /Users/Admin/project/ping_cha
git checkout main
git pull

# 手动复制改动的文件到开源仓库（排除敏感文件）
# 或重新运行 create-opensource-repo.sh

# 在开源仓库
cd /Users/Admin/project/pingcha-public
git add .
git commit -m "feat: add new feature XYZ"
git push
```

**开源仓库 → 私有仓库（社区贡献）：**

```bash
# 在开源仓库收到 PR 并合并后
cd /Users/Admin/project/pingcha-public
git pull

# 在私有仓库
cd /Users/Admin/project/ping_cha
# 手动应用改动（cherry-pick 或直接复制文件）
git add .
git commit -m "feat: merge community contribution from PR #123"
git push
```

### 使用 Git Remote 简化流程

```bash
# 在开源仓库添加私有仓库为 remote
cd /Users/Admin/project/pingcha-public
git remote add private ../ping_cha

# 查看差异
git fetch private
git diff main private/main

# 选择性合并
git cherry-pick <commit-hash>
```

---

## 检查清单

在发布前，请确认：

### 代码安全
- [ ] 运行了 `create-opensource-repo.sh`
- [ ] 检查了 `backend/app/config.py`（无私有 API 网关）
- [ ] 检查了 `docker-compose.yml`（无硬编码代理）
- [ ] 确认没有 `.env` 文件
- [ ] 确认没有 `cookies/` 目录
- [ ] Git 历史只有一个干净的初始 commit

### 文档完整性
- [ ] 有 `LICENSE` 文件（MIT）
- [ ] 有 `CONTRIBUTING.md`
- [ ] 有 Issue 模板
- [ ] README 包含完整的安装说明
- [ ] README 包含 OAuth 配置说明
- [ ] 所有 GitHub 链接已更新

### GitHub 配置
- [ ] 仓库是 Public
- [ ] 添加了项目描述和标签
- [ ] 启用了 Issues
- [ ] 启用了 Discussions（可选）
- [ ] 设置了分支保护（可选）

### 测试
- [ ] 在干净环境运行 `docker-compose up -d`
- [ ] 验证所有服务能启动
- [ ] 检查前端能访问（http://localhost）
- [ ] 验证 `.env.example` 配置足够清晰

---

## 故障排查

### 问题 1：推送时需要认证

**解决方案：**
```bash
# 使用 GitHub CLI
gh auth login

# 或使用 SSH
git remote set-url origin git@github.com:YOUR_USERNAME/pingcha.git
```

### 问题 2：推送被拒绝（already exists）

**解决方案：**
```bash
# 强制推送（仅在初始发布时使用！）
git push -f origin main
```

### 问题 3：脚本执行失败

**检查：**
```bash
# 确认源目录存在
ls -la /Users/Admin/project/ping_cha

# 确认脚本有执行权限
ls -l create-opensource-repo.sh

# 手动运行每一步，查看具体错误
```

---

## 后续步骤

1. **第一个 Release：**
   ```bash
   git tag -a v1.0.0 -m "First public release"
   git push origin v1.0.0
   ```

2. **编写发布说明：** 在 GitHub Releases 页面添加 v1.0.0 的详细说明

3. **设置 CI/CD：** 添加 GitHub Actions 进行自动化测试

4. **Docker Hub：** 发布预构建镜像方便用户使用

5. **文档站点：** 使用 GitHub Pages 或 Vercel 部署完整文档

---

## 需要帮助？

如果遇到任何问题：
1. 查看 `OPENSOURCE_CHECKLIST.md` 的详细说明
2. 在私有仓库中运行 `git log` 确保没有敏感信息
3. 联系项目维护者

祝你开源顺利！🎉
