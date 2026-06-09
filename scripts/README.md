# 测试与管理脚本

这些脚本用于开发和测试环境，生产环境不需要运行。

## 脚本列表

| 脚本 | 用途 | 说明 |
|------|------|------|
| `batch_submit.py` | 批量提交视频/播客 | 用于并发处理压测 |
| `multiuser_test.py` | 多用户并发测试 | 模拟 4 用户 × 3 视频提交 |
| `backfill_titles.py` | 数据回填工具 | 为已有视频补充标题信息 |

## 前置条件

1. 确保 Docker 服务已启动（`docker-compose up -d`）
2. 配置 `.env` 文件（从根目录 `.env.example` 复制并修改）
3. 数据库已完成迁移（`alembic upgrade head`）

## 注意事项

- 脚本中的 JWT_SECRET 必须与 `.env` 中的 `JWT_SECRET_KEY` 一致
- 测试用户 ID 需替换为实际存在的用户 ID
- 这些脚本不适用于生产环境
