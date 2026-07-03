#!/bin/bash
# 品猹性能基准测试
# 测量关键时间点：字幕获取、摘要首字、思维导图、全流程

BASE_URL="${1:-http://localhost:8000}"
RESULTS_FILE="tests/benchmark_results_$(date +%Y%m%d_%H%M%S).json"

echo "=== 品猹 Performance Benchmark ==="
echo "Base URL: $BASE_URL"
echo "Results: $RESULTS_FILE"
echo ""

# 测试 SSE 事件时间点
test_sse_timing() {
  local url=$1
  local video_id=$2

  local START_TIME=$(date +%s%3N)  # 毫秒
  local SUBTITLE_TIME=""
  local FIRST_DELTA_TIME=""
  local MINDMAP_TIME=""
  local DONE_TIME=""

  # 使用 curl 监听 SSE 流（最多30秒）
  timeout 60 curl -s -N "$BASE_URL/api/v1/videos/$video_id/progress/stream" \
    -H "Authorization: Bearer $TOKEN" | while IFS= read -r line; do

    CURRENT=$(date +%s%3N)
    ELAPSED=$(( (CURRENT - START_TIME) ))

    case "$line" in
      *subtitle_ready*)
        echo "  subtitle_ready: ${ELAPSED}ms"
        ;;
      *\"type\":\"delta\"*)
        if [ -z "$FIRST_DELTA_TIME" ]; then
          FIRST_DELTA_TIME=$ELAPSED
          echo "  first_delta: ${ELAPSED}ms"
        fi
        ;;
      *mindmap_ready*)
        echo "  mindmap_ready: ${ELAPSED}ms"
        ;;
      *\"state\":\"done\"*)
        echo "  pipeline_done: ${ELAPSED}ms"
        break
        ;;
    esac
  done
}

# 测试视频列表
declare -a TEST_VIDEOS=(
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ|Rick Astley (3.5min, popular)"
  "https://www.youtube.com/watch?v=jNQXAC9IVRw|Me at the zoo (19s, cold)"
)

echo "["  > "$RESULTS_FILE"

for entry in "${TEST_VIDEOS[@]}"; do
  IFS='|' read -r url desc <<< "$entry"

  echo "--- Testing: $desc ---"
  echo "URL: $url"

  # 提交视频
  T_START=$(date +%s%3N)
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/videos" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"url\": \"$url\"}" \
    -w "\n%{time_total}")

  SUBMIT_TIME=$(echo "$RESPONSE" | tail -1)
  VIDEO_ID=$(echo "$RESPONSE" | head -1 | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

  echo "  submit_time: ${SUBMIT_TIME}s"
  echo "  video_id: $VIDEO_ID"

  if [ -n "$VIDEO_ID" ]; then
    test_sse_timing "$url" "$VIDEO_ID"
  fi

  echo ""
done

echo "=== Benchmark Complete ==="
echo "Results saved to: $RESULTS_FILE"
