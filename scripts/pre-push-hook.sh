#!/bin/bash
# pre-push hook: 阻止密钥/敏感信息被推送到远程仓库
# 兼容 macOS（BSD grep）和 Linux（GNU grep）

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 敏感模式列表（POSIX Extended Regex，兼容 macOS）
PATTERNS=(
    'OPENAI_API_KEY[[:space:]]*=[[:space:]]*sk-[a-zA-Z0-9]{20,}'
    'ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*sk-ant-[a-zA-Z0-9]{20,}'
    'DASHSCOPE_API_KEY[[:space:]]*=[[:space:]]*sk-[a-zA-Z0-9]{20,}'
    'RESEND_API_KEY[[:space:]]*=[[:space:]]*re_[a-zA-Z0-9]{20,}'
    'TIKHUB_API_KEY[[:space:]]*=[[:space:]]*[a-zA-Z0-9+/=]{20,}'
    'SENTRY_AUTH_TOKEN[[:space:]]*=[[:space:]]*sntrys_[a-zA-Z0-9]{20,}'
    'SUPADATA_API_KEY[[:space:]]*=[[:space:]]*sd_[a-zA-Z0-9]{10,}'
    'TRANSCRIPTAPI_API_KEY[[:space:]]*=[[:space:]]*sk_[a-zA-Z0-9]{10,}'
    'RAPIDAPI_KEY[[:space:]]*=[[:space:]]*[a-zA-Z0-9]{20,}'
    'WATCHA_CLIENT_SECRET[[:space:]]*=[[:space:]]*[a-zA-Z0-9]{10,}'
    'XFYUN_API_SECRET[[:space:]]*=[[:space:]]*[a-zA-Z0-9]{10,}'
    'VOLC_ASR_ACCESS_TOKEN[[:space:]]*=[[:space:]]*[a-zA-Z0-9]{10,}'
    'JWT_SECRET_KEY[[:space:]]*=[[:space:]]*[a-zA-Z0-9_/+=\-]{32,}'
)

# 排除占位符（这些值不算泄露）
PLACEHOLDERS='your[-_]key[-_]here|your_client_id_here|your_client_secret_here|changeme|CHANGE_ME|xxx|placeholder'

remote="$1"
url="$2"

z40=0000000000000000000000000000000000000000

FOUND_SECRETS=0

while read local_ref local_sha remote_ref remote_sha; do
    if [ "$local_sha" = "$z40" ]; then
        continue
    fi

    if [ "$remote_sha" = "$z40" ]; then
        range="$(git merge-base HEAD main 2>/dev/null || echo "$local_sha")...$local_sha"
    else
        range="$remote_sha...$local_sha"
    fi

    # 获取 diff 内容（排除安全的文件）
    DIFF_CONTENT=$(git diff "$range" -- . \
        ':!.env.example' \
        ':!.gitignore' \
        ':!CLAUDE.md' \
        ':!*.sample' \
        ':!scripts/pre-push-hook.sh' \
        2>/dev/null || true)

    if [ -z "$DIFF_CONTENT" ]; then
        continue
    fi

    for pattern in "${PATTERNS[@]}"; do
        MATCHES=$(echo "$DIFF_CONTENT" | grep -En "$pattern" 2>/dev/null | grep -Ev "$PLACEHOLDERS" || true)

        if [ -n "$MATCHES" ]; then
            if [ "$FOUND_SECRETS" -eq 0 ]; then
                echo -e "${RED}[pre-push] 密钥泄露检测 — 推送被阻止!${NC}"
                echo ""
            fi
            FOUND_SECRETS=1
            echo -e "${YELLOW}匹配模式:${NC} $pattern"
            echo "$MATCHES" | head -3
            echo ""
        fi
    done

    # 检查 .env 文件是否被提交
    ENV_FILES=$(git diff --name-only "$range" 2>/dev/null | grep -E '^\.env$|^\.env\.local$' || true)
    if [ -n "$ENV_FILES" ]; then
        if [ "$FOUND_SECRETS" -eq 0 ]; then
            echo -e "${RED}[pre-push] 密钥泄露检测 — 推送被阻止!${NC}"
            echo ""
        fi
        FOUND_SECRETS=1
        echo -e "${YELLOW}检测到 .env 文件将被推送:${NC}"
        echo "$ENV_FILES"
        echo ""
    fi
done

if [ "$FOUND_SECRETS" -ne 0 ]; then
    echo -e "${RED}请移除上述敏感信息后重新推送。${NC}"
    echo "如果确认是误报，可使用 git push --no-verify 强制推送（不推荐）。"
    exit 1
fi

echo "[pre-push] 密钥检查通过"
exit 0
