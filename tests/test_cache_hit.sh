#!/bin/bash
# 测试字幕缓存命中率
# 同一视频提交两次，第二次应该从缓存读取

BASE_URL="${1:-http://localhost:8000}"
URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ"

echo "=== Cache Hit Rate Test ==="
echo ""

# 第一次请求
echo "1st request (cold):"
T1_START=$(date +%s%3N)
curl -s -X POST "$BASE_URL/api/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"url\": \"$URL\"}" > /dev/null
T1_END=$(date +%s%3N)
echo "  Time: $(( T1_END - T1_START ))ms"

# 等待处理完成
sleep 15

# 第二次请求（应命中缓存）
echo ""
echo "2nd request (should hit cache):"
T2_START=$(date +%s%3N)
curl -s -X POST "$BASE_URL/api/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"url\": \"$URL\"}" > /dev/null
T2_END=$(date +%s%3N)
echo "  Time: $(( T2_END - T2_START ))ms"

echo ""
echo "Expected: 2nd request should be significantly faster due to Redis cache"
