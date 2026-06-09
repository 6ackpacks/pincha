# Pingcha 项目 Docker 使用完全手册

> 适用项目：品阅（Pingcha）—— 一个由 10 个服务组成的 Docker Compose 应用
> 服务清单：frontend (Next.js)、backend (FastAPI)、celery_fast、celery_pipeline、celery_cron、celery_beat、db (PostgreSQL+pgvector)、redis、minio、nginx

---

## 第一部分：Docker 核心概念

### 1.1 Image vs Container vs Volume 的区别

| 概念 | 类比 | 说明 |
|------|------|------|
| **Image（镜像）** | 可执行程序的安装包 | 只读的模板，包含运行环境、依赖、代码的快照。`docker build` 生成 image。 |
| **Container（容器）** | 运行中的程序进程 | Image 的一个运行实例。可以启动、停止、删除。删掉容器不会删 image。 |
| **Volume（数据卷）** | 外挂硬盘 / 共享文件夹 | 独立于容器生命周期的持久化存储。容器删了，Volume 里的数据还在。 |

**三者关系示意：**
```
Image (模板) → docker run → Container (运行实例)
                               ↕ 挂载
                          Volume (数据持久化)
```

**本项目中的 Volume 使用：**
- `pgdata` — PostgreSQL 数据库文件（Named Volume，持久化数据库）
- `redisdata` — Redis 数据（Named Volume）
- `miniodata` — MinIO 对象存储数据（Named Volume）
- `./backend:/app` — 后端代码目录（Bind Mount，宿主机目录直接挂载进容器）
- `./frontend:/app` — 前端代码目录（Bind Mount）
- `/app/node_modules` — 容器内 node_modules（Anonymous Volume，防止被宿主机覆盖）

> **关键理解**：因为 backend 和 frontend 使用了 Bind Mount (`./backend:/app`)，
> 修改宿主机代码后**容器内立即可见，无需重建镜像**。

---

### 1.2 docker-compose.yml 结构解读

本项目 `docker-compose.yml` 的整体结构：

```yaml
version: "3.8"

services:
  frontend:           # 服务名
    build:            # 从 Dockerfile 构建（有 build 字段说明需要构建镜像）
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"   # 宿主机端口:容器端口
    volumes:
      - ./frontend:/app     # Bind Mount：宿主机代码 → 容器内
      - /app/node_modules   # Anonymous Volume：保护容器内的 node_modules
    depends_on:
      - backend       # 依赖其他服务先启动

  db:
    image: pgvector/pgvector:pg16  # 直接用官方镜像，无需构建
    volumes:
      - pgdata:/var/lib/postgresql/data  # Named Volume：持久化数据

volumes:              # 声明 Named Volumes
  pgdata:
  redisdata:
  miniodata:
```

**服务分两类：**
1. **需要构建的服务**（有 `build` 字段）：frontend、backend、celery_fast、celery_pipeline、celery_cron、celery_beat
2. **直接用官方镜像的服务**（只有 `image` 字段）：db、redis、minio、nginx、bgutil-provider

---

## 第二部分：常用命令速查

### 2.1 启动 / 停止 / 重启

```bash
# 启动所有服务（后台运行）
docker compose up -d

# 停止所有服务（容器停止，数据保留）
docker compose down

# 停止并删除数据卷（⚠️ 慎用！会清空数据库、Redis、MinIO 数据）
docker compose down -v

# 只启动指定服务
docker compose up -d backend celery_fast celery_pipeline

# 只停止指定服务
docker compose stop celery_fast celery_pipeline

# 重启指定服务（不重建，不更新 image）
docker compose restart celery_fast celery_pipeline
```

### 2.2 查看日志

```bash
# 查看所有服务日志（持续输出）
docker compose logs -f

# 只看 backend 的日志
docker compose logs -f backend

# 只看 celery 相关日志
docker compose logs -f celery_fast celery_pipeline celery_cron

# 查看最后 100 行日志
docker compose logs --tail=100 backend

# 查看 nginx 日志
docker compose logs -f nginx
```

### 2.3 查看服务状态

```bash
# 查看所有容器状态（是否运行、健康状态）
docker compose ps

# 查看所有容器（包括已停止的）
docker ps -a

# 查看镜像列表
docker images

# 查看磁盘使用情况
docker system df
```

### 2.4 进入容器调试

```bash
# 进入 backend 容器（获得 bash 终端）
docker compose exec backend bash

# 进入 backend 容器执行单条命令（不进交互模式）
docker compose exec backend python -c "from app.main import app; print('OK')"

# 在 backend 容器内运行数据库迁移
docker compose exec backend alembic upgrade head

# 进入 PostgreSQL 数据库
docker compose exec db psql -U postgres -d pingcha

# 进入 Redis
docker compose exec redis redis-cli

# 进入 MinIO 查看 bucket
docker compose exec minio mc ls local/
```

### 2.5 构建镜像

```bash
# 构建所有服务的镜像
docker compose build

# 只构建 backend 镜像
docker compose build backend

# 不使用缓存构建（完全重建，较慢）
docker compose build --no-cache backend

# 构建时不重建依赖服务
docker compose build --no-deps frontend
```

---

## 第三部分：什么时候需要重建？（最重要）

### 3.1 决策表

| 发生了什么 | 需要做什么 | 原因 |
|-----------|-----------|------|
| **只修改了 Python/TS 代码**（backend/、frontend/） | 无需任何操作，或最多 `restart` | Bind Mount 使容器实时看到代码变化；FastAPI `--reload` 会自动重载 |
| **修改了 `requirements.txt`**（Python 依赖） | `docker compose build backend` → `docker compose up -d --no-deps --force-recreate backend celery_fast celery_pipeline celery_cron celery_beat` | 依赖安装进了 image，需要重建 image |
| **修改了 `package.json`**（Node 依赖） | `docker compose build --no-deps frontend` → `docker compose up -d --no-deps --force-recreate frontend` | node_modules 在 image 里，需要重建 |
| **修改了 `.env` 环境变量** | `docker compose up -d --force-recreate <服务名>` | 环境变量变更需要重建容器（不需要重建镜像） |
| **修改了 `docker-compose.yml`** | `docker compose up -d` | Compose 会自动检测配置变更并重建受影响的容器 |
| **修改了 `Dockerfile`** | `docker compose build <服务名>` → `docker compose up -d --force-recreate <服务名>` | Dockerfile 变更需要重建镜像 |
| **容器挂掉/卡住** | `docker compose restart <服务名>` 或 `docker compose up -d --force-recreate <服务名>` | restart 不重建；force-recreate 创建全新容器 |
| **完整重置（保留数据库）** | `docker compose down` → `docker compose up -d` | 停止所有容器后重启 |
| **完整重置（清空所有数据）** | `docker compose down -v` → `docker compose up -d` | `-v` 同时删除数据卷 |

---

### 3.2 常用重建场景的具体命令

#### 场景 A：修改了后端代码（仅代码，无新依赖）
```bash
# 无需任何操作
# FastAPI 使用 --reload，代码变更自动生效
# 如果不确定，最多执行：
docker compose restart backend
```

#### 场景 B：修改了 Celery 任务代码
```bash
# Celery worker 不自动重载，需要手动重启
# 因为 backend/ 目录是 Bind Mount，无需重建镜像
docker compose up -d --force-recreate celery_pipeline celery_fast
```

#### 场景 C：修改了 `requirements.txt`（新增 Python 包）
```bash
# 第一步：重建 backend 镜像（celery 共用同一个 image）
docker compose build backend

# 第二步：用新镜像重建所有受影响的容器
docker compose up -d --no-deps --force-recreate backend celery_fast celery_pipeline celery_cron celery_beat
```

#### 场景 D：修改了前端依赖 `package.json`
```bash
# 重建前端镜像（不重建其依赖服务）
docker compose build --no-deps frontend

# 用新镜像重建前端容器
docker compose up -d --no-deps --force-recreate frontend
```

#### 场景 E：修改了 `.env` 文件中的 API Key
```bash
# 环境变量变更需要重建容器（不用重建镜像）
docker compose up -d --force-recreate backend celery_fast celery_pipeline celery_cron celery_beat
```

#### 场景 F：数据库结构变更（新增 Alembic 迁移）
```bash
# 在 backend 容器内执行迁移（无需重建任何东西）
docker compose exec backend alembic upgrade head
```

#### 场景 G：完全从零开始（数据库也清空）
```bash
# 停止所有服务并删除数据卷
docker compose down -v

# 重建所有自定义镜像
docker compose build

# 重新启动
docker compose up -d

# 运行数据库迁移（稍等数据库启动完成）
sleep 5 && docker compose exec backend alembic upgrade head
```

---

### 3.3 `--build` vs `--force-recreate` vs `restart` 的区别

```
docker compose restart <服务>
  → 仅重启进程
  → 不更新镜像，不更新容器配置
  → 最快，适合临时故障

docker compose up -d --force-recreate <服务>
  → 强制重建容器（停止→删除→新建→启动）
  → 不重建镜像（仍用旧镜像）
  → 适合：.env 变更、容器状态损坏、配置更新

docker compose build <服务>
  → 只重建镜像，不重启容器
  → 需要再跟 up --force-recreate 才生效

docker compose up -d --build <服务>
  → 先重建镜像，再按需重建容器
  → 适合：Dockerfile 或依赖文件变更后一步完成
```

---

## 第四部分：网络问题解决方案（在中国）

### 4.1 背景：2024年6月后的现状

> **重要变化**：2024年6月6日起，阿里云、腾讯云、网易云、百度云等主流 Docker Hub 镜像加速服务**全部停止公共服务**。大学镜像（USTC、南大等）也改为仅校园网可用。
>
> **如果你的 `daemon.json` 里还配着阿里云/腾讯云的老地址——请删掉，它们已经失效了。**

---

### 4.2 方案一（推荐）：配置 Docker 走本机代理

如果你本机已有代理工具（如 Clash、v2rayN 等监听 7897 端口），这是最稳定的方案。

**Docker Desktop 图形界面配置（最简单）：**

1. 打开 Docker Desktop
2. 点击右上角 **齿轮图标 (Settings)**
3. 进入 **Resources → Proxies**
4. 勾选 **Manual proxy configuration**
5. 填入：
   - HTTP proxy: `http://127.0.0.1:7897`
   - HTTPS proxy: `http://127.0.0.1:7897`
   - Bypass: `localhost,127.0.0.1,host.docker.internal`
6. 点击 **Apply & restart**

> 说明：上述端口 7897 请替换为你实际的代理端口（Clash 默认 7890，v2rayN 默认 10809）。

**通过 Docker Desktop 的 Engine 配置（daemon.json 方式）：**

1. 打开 Docker Desktop → Settings → **Docker Engine**
2. 在 JSON 配置中添加：

```json
{
  "proxies": {
    "http-proxy": "http://host.docker.internal:7897",
    "https-proxy": "http://host.docker.internal:7897",
    "no-proxy": "localhost,127.0.0.1,host.docker.internal"
  }
}
```

3. 点击 **Apply & restart**

> `host.docker.internal` 是 Docker Desktop 内置的特殊 DNS 名称，指向宿主机 IP，在 Windows/Mac 上均可用。

---

### 4.3 方案二：配置镜像加速器（2025年可用镜像）

> 注意：社区维护的镜像随时可能停止服务，以下为截至 2025 年底仍可用的镜像。

**Windows Docker Desktop 配置位置：**
- 图形界面：Settings → Docker Engine（JSON 编辑器）
- 文件路径：`C:\Users\<你的用户名>\.docker\daemon.json`

**配置示例（daemon.json）：**

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.xuanyuan.me"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

配置完成后，点击 **Apply & restart**（图形界面）或执行：
```bash
# 在 WSL2 内或 Linux 上
sudo systemctl daemon-reload
sudo systemctl restart docker
```

**验证配置是否生效：**
```bash
docker info | grep -A 5 "Registry Mirrors"
```

---

### 4.4 方案三：拉取失败时的应急备选方案

#### 方法 A：使用 GitHub Actions 中转拉取
在中国境外（如 GitHub Actions 免费额度）构建镜像并推送到 GitHub Container Registry（ghcr.io），再从国内拉取。本方案适合有 GitHub 账号的开发者。

#### 方法 B：指定完整镜像地址绕过 Docker Hub
```bash
# 使用 DaoCloud 代理直接指定拉取（针对特定镜像）
docker pull docker.m.daocloud.io/library/nginx:alpine
docker pull docker.m.daocloud.io/pgvector/pgvector:pg16
docker pull docker.m.daocloud.io/redis:7-alpine
docker pull docker.m.daocloud.io/minio/minio
```

然后给镜像打 tag 恢复原来的名字：
```bash
docker tag docker.m.daocloud.io/library/nginx:alpine nginx:alpine
```

#### 方法 C：使用社区维护的镜像源列表
参考 GitHub 仓库 [dongyubin/DockerHub](https://github.com/dongyubin/DockerHub)，该仓库持续更新可用的国内镜像源列表。

---

### 4.5 本项目 docker-compose.yml 中的代理配置说明

本项目已为需要访问外网的服务预置了代理配置：

```yaml
# backend 和 celery worker 中
- YOUTUBE_PROXY=http://host.docker.internal:7897   # yt-dlp 用这个下载视频
- HTTP_PROXY=        # 留空，避免干扰内部服务通信
- HTTPS_PROXY=       # 留空，避免干扰内部服务通信

# bgutil-provider（YouTube token 服务）
- HTTP_PROXY=http://host.docker.internal:7897
- HTTPS_PROXY=http://host.docker.internal:7897
```

如果你的代理端口不是 7897，需要修改 `docker-compose.yml` 中的代理端口，然后：
```bash
docker compose up -d --force-recreate backend celery_fast celery_pipeline bgutil-provider
```

---

## 第五部分：调试技巧

### 5.1 查看容器内部文件

```bash
# 进入 backend 容器查看文件
docker compose exec backend ls -la /app

# 查看容器内的 Python 包是否已安装
docker compose exec backend pip list | grep litellm

# 查看容器内的环境变量
docker compose exec backend env | grep DATABASE

# 从容器内复制文件到宿主机
docker cp pingcha-backend-1:/app/logs/app.log ./app.log
```

### 5.2 手动执行命令调试

```bash
# 在 backend 容器内手动测试数据库连接
docker compose exec backend python -c "
import asyncio
from app.database import engine
async def test():
    async with engine.begin() as conn:
        result = await conn.execute('SELECT 1')
        print('DB OK:', result.scalar())
asyncio.run(test())
"

# 手动触发 Celery 任务
docker compose exec celery_fast celery -A app.tasks.celery_app inspect active

# 查看 Celery 队列状态
docker compose exec celery_fast celery -A app.tasks.celery_app inspect stats

# 查看 Redis 中的心跳 key
docker compose exec redis redis-cli keys "video:*:heartbeat"

# 测试 MinIO 连通性
docker compose exec backend python -c "
from minio import Minio
client = Minio('minio:9000', access_key='minioadmin', secret_key='minioadmin', secure=False)
print('Buckets:', list(client.list_buckets()))
"
```

### 5.3 常见故障排查

```bash
# 容器启动失败 → 查看退出日志
docker compose logs backend --tail=50

# 查看某个容器的详细信息（网络、挂载、环境变量）
docker inspect pingcha-backend-1

# 查看容器的资源占用（CPU、内存）
docker stats --no-stream

# 检查端口是否被占用
netstat -ano | findstr "8000"    # Windows
lsof -i :8000                   # Linux/Mac
```

### 5.4 清理磁盘空间（prune）

> Docker 构建缓存和旧镜像会占用大量磁盘空间，定期清理有益。

```bash
# 查看当前磁盘使用
docker system df

# 清理所有未使用的资源（镜像、容器、网络）—— 推荐，较安全
docker system prune

# 清理所有未使用资源（包括未使用的 Volume）—— ⚠️ 会删除数据！
docker system prune -v

# 只清理构建缓存（最安全，不影响运行）
docker builder prune

# 清理悬空镜像（dangling images，即没有 tag 的旧镜像）
docker image prune

# 强制清理所有未运行的容器
docker container prune
```

**本项目推荐的清理命令（不影响数据）：**
```bash
# 先停止服务
docker compose down

# 清理构建缓存和悬空镜像
docker system prune
docker image prune

# 重新启动
docker compose up -d
```

---

### 5.5 完整重置流程（开发环境从零开始）

```bash
# 1. 停止所有服务，删除容器和网络
docker compose down

# 2. 删除本项目相关镜像（强制重建）
docker compose build --no-cache

# 3. 启动所有服务
docker compose up -d

# 4. 等待数据库就绪（约 5-10 秒）
docker compose logs -f db  # 看到 "database system is ready" 后按 Ctrl+C

# 5. 执行数据库迁移
docker compose exec backend alembic upgrade head

# 6. 确认所有服务正常运行
docker compose ps
```

---

## 附录：本项目服务端口一览

| 服务 | 容器端口 | 宿主机端口 | 说明 |
|------|---------|-----------|------|
| nginx | 80 | 80 | 统一入口（推荐访问此端口） |
| frontend | 3000 | 3000 | Next.js 开发服务器 |
| backend | 8000 | 8000 | FastAPI |
| db | 5432 | 5432 | PostgreSQL |
| redis | 6379 | 6379 | Redis |
| minio API | 9000 | 9000 | MinIO S3 API |
| minio Console | 9001 | 9001 | MinIO Web 控制台 |
| bgutil-provider | 4416 | 4416 | YouTube token 服务 |

**日常开发访问地址：**
- 应用主入口：http://localhost（通过 nginx 代理）
- 直接访问前端：http://localhost:3000
- API 文档：http://localhost:8000/docs
- MinIO 管理控制台：http://localhost:9001（用户名/密码：minioadmin/minioadmin）

---

## 附录：快速参考卡

```
常见操作速查：

启动项目：        docker compose up -d
停止项目：        docker compose down
看 backend 日志：  docker compose logs -f backend
进入 backend：    docker compose exec backend bash
跑迁移：          docker compose exec backend alembic upgrade head
重启 Celery：     docker compose up -d --force-recreate celery_pipeline celery_fast
重建 backend：    docker compose build backend && docker compose up -d --no-deps --force-recreate backend celery_fast celery_pipeline celery_cron celery_beat
重建 frontend：   docker compose build --no-deps frontend && docker compose up -d --no-deps --force-recreate frontend
清理磁盘：        docker system prune && docker builder prune
```

---

*参考资料：*
- [Docker Compose up 官方文档](https://docs.docker.com/reference/cli/docker/compose/up/)
- [Docker Desktop 代理配置](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
- [Docker Desktop Windows 安装指南](https://docs.docker.com/desktop/setup/install/windows-install/)
- [Docker bind mounts 文档](https://docs.docker.com/engine/storage/bind-mounts/)
- [Compose Watch 功能](https://docs.docker.com/compose/how-tos/file-watch/)
- [2025 中国 Docker 镜像使用指南](https://eastondev.com/blog/en/posts/dev/20251217-docker-mirror-guide-2025/)
- [在中国使用 Docker 的实用方案](https://dev.to/topunix/using-docker-in-china-practical-workarounds-for-developers-26lp)
- [dongyubin/DockerHub 国内可用镜像持续更新列表](https://github.com/dongyubin/DockerHub)
