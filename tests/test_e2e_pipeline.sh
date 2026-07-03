#!/bin/bash
# 品猹视频处理 E2E 测试
# 用法: bash tests/test_e2e_pipeline.sh [BASE_URL]

BASE_URL="${1:-http://localhost:8000}"
PASSED=0
FAILED=0

# 测试视频列表
declare -a VIDEOS=(
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"   # 3.5分钟 热门
  "https://www.youtube.com/watch?v=jNQXAC9IVRw"   # 19秒 冷门
)

echo "=== 品猹 E2E Pipeline Test ==="
echo "Base URL: $BASE_URL"
echo ""

for url in "${VIDEOS[@]}"; do
  echo "Testing: $url"

  # 1. 提交视频
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/videos" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"url\": \"$url\"}")

  VIDEO_ID=$(echo $RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

  if [ -z "$VIDEO_ID" ]; then
    echo "  FAIL: Could not submit video"
    FAILED=$((FAILED + 1))
    continue
  fi

  echo "  Video ID: $VIDEO_ID"

  # 2. 等待处理完成（最多60秒）
  for i in $(seq 1 60); do
    STATUS=$(curl -s "$BASE_URL/api/v1/videos/$VIDEO_ID" \
      -H "Authorization: Bearer $TOKEN" | \
      python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('state','pending'))" 2>/dev/null)

    if [ "$STATUS" = "done" ]; then
      echo "  Status: done (${i}s)"
      break
    elif [ "$STATUS" = "failed" ]; then
      echo "  FAIL: Pipeline failed"
      FAILED=$((FAILED + 1))
      continue 2
    fi
    sleep 1
  done

  if [ "$STATUS" != "done" ]; then
    echo "  FAIL: Timeout after 60s (status: $STATUS)"
    FAILED=$((FAILED + 1))
    continue
  fi

  # 3. 验证数据存在
  # 检查字幕
  TRANSCRIPT=$(curl -s "$BASE_URL/api/v1/videos/$VIDEO_ID/transcript" \
    -H "Authorization: Bearer $TOKEN")
  SEG_COUNT=$(echo $TRANSCRIPT | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('segments',[])))" 2>/dev/null)

  if [ "$SEG_COUNT" -gt 0 ] 2>/dev/null; then
    echo "  Transcript: OK ($SEG_COUNT segments)"
  else
    echo "  FAIL: No transcript segments"
    FAILED=$((FAILED + 1))
    continue
  fi

  # 检查摘要
  SUMMARIES=$(curl -s "$BASE_URL/api/v1/videos/$VIDEO_ID/summaries" \
    -H "Authorization: Bearer $TOKEN")
  SUM_COUNT=$(echo $SUMMARIES | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null)

  if [ "$SUM_COUNT" -gt 0 ] 2>/dev/null; then
    echo "  Summaries: OK ($SUM_COUNT levels)"
  else
    echo "  WARN: No summaries found"
  fi

  PASSED=$((PASSED + 1))
  echo "  PASS"
  echo ""
done

echo "=== Results: $PASSED passed, $FAILED failed ==="
