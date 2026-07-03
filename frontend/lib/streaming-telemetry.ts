/**
 * Streaming UI 可观测性模块（前端 trace 维度：video_id + generation_id + ui_session_id）。
 *
 * 目标：当用户感觉闪烁 / 内容消失重现 / 流式卡住 / 卡顿时，能按
 * `video_id + generation_id + ui_session_id` 查到原因。
 *
 * 设计要点：
 * - 统一入口 `trackStreamingUIEvent(event)`，禁止在业务代码里散落 console.log。
 * - 绝不记录摘要正文，只允许 `content_length`。
 * - timestamp 字段统一使用 `Date.now()`（epoch 毫秒，便于跨事件排序/查询）；
 *   延迟类指标（first_delta_latency_ms / delta_to_paint_ms 等）由调用方用
 *   `nowMs()`（优先 performance.now() 的单调时钟）做差值后传入。
 * - 输出策略：
 *   - dev 态（`NEXT_PUBLIC_STREAMING_DEBUG === "true"`）：全量记录 + 结构化 console。
 *   - 生产态：正常事件按 generation 确定性采样，异常 / 阈值事件全量。
 * - 上报通道：本 PR 不新建后端 endpoint。内置一个内存 ring buffer（始终写入，
 *   供测试 / 调试通过 `getStreamingTelemetryBuffer()` 查询），并预留可插拔 sink
 *   （`setStreamingTelemetrySink`）方便以后接 Sentry/telemetry。
 *
 * 生产接 sink 的方式（示例，本 PR 不接）：
 *   setStreamingTelemetrySink((event) => {
 *     // 例如转发到 Sentry breadcrumb 或自建 telemetry endpoint
 *     Sentry.addBreadcrumb({ category: "streaming-ui", level: event.severity, data: event });
 *   });
 * ring buffer 始终独立写入，替换 sink 不影响 `getStreamingTelemetryBuffer()`。
 *
 * SSR 安全：所有 performance / PerformanceObserver / requestAnimationFrame / window
 * / crypto 访问都做 `typeof !== "undefined"` 守卫。
 */

export type StreamingEventType =
  | "summary_panel_mount"
  | "summary_panel_unmount"
  | "summary_panel_key_changed"
  | "stream_delta_received"
  | "stream_delta_applied"
  | "stream_delta_dropped_stale_generation"
  | "stream_snapshot_applied"
  | "stream_reset_applied"
  | "stream_done_received"
  | "stream_finalize_started"
  | "stream_finalize_skipped_duplicate"
  | "query_set_data"
  | "query_invalidated"
  | "query_refetch_started"
  | "query_refetch_success"
  | "summary_content_became_empty"
  | "summary_content_restored"
  | "sse_open"
  | "sse_close"
  | "sse_reconnect"
  | "ui_long_task"
  | "delta_to_paint_slow";

export type StreamingEventSource =
  | "delta"
  | "replay"
  | "snapshot"
  | "done"
  | "refetch"
  | "invalidate"
  | "reconnect";

export type StreamingSeverity = "info" | "warning";

export type StreamingMetricName =
  | "first_delta_latency_ms"
  | "delta_to_paint_ms"
  | "finalize_to_stable_ms"
  | "render_count_during_stream"
  | "sse_reconnect_count"
  | "long_task_duration_ms";

/** trace 维度：每条事件都带，用于按 video_id + generation_id + ui_session_id 查询。 */
export interface StreamingTrace {
  video_id: string;
  generation_id: string;
  ui_session_id: string;
  active_level: string | null;
}

/** 调用方传入的事件（trace 中的 ui_session_id 由模块自动补全，可不传）。 */
export interface StreamingUIEventInput {
  event_type: StreamingEventType;
  video_id: string;
  generation_id: string;
  ui_session_id?: string;
  active_level?: string | null;
  /** SSE 序号（若后端提供）。 */
  seq?: number;
  /** 事件来源通道。 */
  source?: StreamingEventSource;
  /** 组件 render 次数（panel 用）。 */
  render_count?: number;
  /** 组件 key（用于追踪重挂）。 */
  component_key?: string;
  /** 人类可读原因（如 key 变化的 from→to）。 */
  reason?: string;
  /** 内容长度（绝不记录正文，只记录长度）。 */
  content_length?: number;
  /** 严重级别；不传则按事件类型自动推导。 */
  severity?: StreamingSeverity;
}

/** 落盘 / 上报的完整事件结构（已补全 ui_session_id / timestamp / severity）。 */
export interface StreamingUIEvent extends StreamingUIEventInput {
  ui_session_id: string;
  active_level: string | null;
  /** Date.now() epoch 毫秒。 */
  timestamp: number;
  severity: StreamingSeverity;
}

export type StreamingTelemetrySink = (event: StreamingUIEvent) => void;

// ---------------------------------------------------------------------------
// ID 生成 / 时钟
// ---------------------------------------------------------------------------

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 旧浏览器 / SSR 降级：足够唯一即可（仅用于前端 trace）。
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 每个浏览器标签页一次（模块级生成一次）。 */
const UI_SESSION_ID = generateId();

export function getUiSessionId(): string {
  return UI_SESSION_ID;
}

/** 创建一个新的 generation_id（一轮生成对应一个）。 */
export function createGenerationId(): string {
  return generateId();
}

/** 单调时钟（优先 performance.now()），用于计算延迟差值。 */
export function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

// ---------------------------------------------------------------------------
// 输出策略：debug / 采样
// ---------------------------------------------------------------------------

const DEBUG_ENABLED = process.env.NEXT_PUBLIC_STREAMING_DEBUG === "true";

/** 采样比例：生产态正常事件按 generation 采样（约 1/SAMPLE_RATE 的 generation 全量记录）。 */
const SAMPLE_RATE = 5;

/** 这些事件类型始终视为异常 → warning + 全量记录。 */
const ALWAYS_WARNING: ReadonlySet<StreamingEventType> = new Set<StreamingEventType>([
  "summary_content_became_empty",
  "delta_to_paint_slow",
  "ui_long_task",
  "stream_finalize_skipped_duplicate",
]);

function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/** 确定性采样：同一 (session, generation) 要么全量要么全丢，避免无限打印。 */
function isGenerationSampled(generationId: string): boolean {
  return djb2(`${UI_SESSION_ID}:${generationId}`) % SAMPLE_RATE === 0;
}

function resolveSeverity(input: StreamingUIEventInput): StreamingSeverity {
  if (ALWAYS_WARNING.has(input.event_type)) return "warning";
  return input.severity ?? "info";
}

// ---------------------------------------------------------------------------
// Ring buffer（始终写入，供测试 / 调试查询）
// ---------------------------------------------------------------------------

const RING_BUFFER_SIZE = 500;
const ringBuffer: StreamingUIEvent[] = [];

function pushToBuffer(event: StreamingUIEvent): void {
  ringBuffer.push(event);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
}

export interface TelemetryBufferQuery {
  video_id?: string;
  generation_id?: string;
  ui_session_id?: string;
  event_type?: StreamingEventType;
  severity?: StreamingSeverity;
}

/**
 * 读取 telemetry ring buffer（返回副本）。可按 video_id + generation_id +
 * ui_session_id 等维度过滤，供测试断言与线上调试使用。
 */
export function getStreamingTelemetryBuffer(
  query?: TelemetryBufferQuery,
): StreamingUIEvent[] {
  if (!query) return [...ringBuffer];
  return ringBuffer.filter((e) => {
    if (query.video_id !== undefined && e.video_id !== query.video_id) return false;
    if (query.generation_id !== undefined && e.generation_id !== query.generation_id) return false;
    if (query.ui_session_id !== undefined && e.ui_session_id !== query.ui_session_id) return false;
    if (query.event_type !== undefined && e.event_type !== query.event_type) return false;
    if (query.severity !== undefined && e.severity !== query.severity) return false;
    return true;
  });
}

/** 清空 ring buffer（主要供测试隔离用例使用）。 */
export function clearStreamingTelemetryBuffer(): void {
  ringBuffer.length = 0;
}

// ---------------------------------------------------------------------------
// 可插拔 sink（默认 dev-console）
// ---------------------------------------------------------------------------

const devConsoleSink: StreamingTelemetrySink = (event) => {
  if (!DEBUG_ENABLED) return;
  // 结构化对象（非纯字符串），便于浏览器控制台展开 / 过滤。
  if (event.severity === "warning") {
    console.warn("[streaming-ui]", event.event_type, event);
  } else {
    console.debug("[streaming-ui]", event.event_type, event);
  }
};

let currentSink: StreamingTelemetrySink = devConsoleSink;

/**
 * 替换上报 sink（以后接 Sentry/telemetry）。ring buffer 始终独立写入，
 * 替换 sink 不影响 `getStreamingTelemetryBuffer()`。传入新 sink 后默认的
 * dev-console 输出会被取代，如需保留可在自定义 sink 内自行调用 console。
 */
export function setStreamingTelemetrySink(sink: StreamingTelemetrySink): void {
  currentSink = sink;
}

/** 还原为默认 dev-console sink（供测试 / 调试重置）。 */
export function resetStreamingTelemetrySink(): void {
  currentSink = devConsoleSink;
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

/**
 * 记录一条 streaming UI 事件。
 *
 * 输出策略：
 * - debug 态：全量记录。
 * - 生产态：warning 全量；info 按 generation 确定性采样。
 *
 * 无论是否命中采样，warning 事件与 debug 态事件都会写入 ring buffer 与 sink。
 */
export function trackStreamingUIEvent(input: StreamingUIEventInput): void {
  const severity = resolveSeverity(input);

  const shouldRecord =
    DEBUG_ENABLED ||
    severity === "warning" ||
    isGenerationSampled(input.generation_id);

  if (!shouldRecord) return;

  const event: StreamingUIEvent = {
    ...input,
    ui_session_id: input.ui_session_id ?? UI_SESSION_ID,
    active_level: input.active_level ?? null,
    timestamp: Date.now(),
    severity,
  };

  pushToBuffer(event);

  try {
    currentSink(event);
  } catch {
    // sink 不可用不应影响主流程。
  }
}

// ---------------------------------------------------------------------------
// 体验指标累积器（per-generation）
// ---------------------------------------------------------------------------

export interface GenerationMetrics {
  generation_id: string;
  first_delta_latency_ms?: number;
  /** 最近一次 delta→paint 耗时。 */
  delta_to_paint_ms?: number;
  /** delta→paint 峰值。 */
  delta_to_paint_ms_max?: number;
  finalize_to_stable_ms?: number;
  render_count_during_stream: number;
  sse_reconnect_count: number;
  /** long task 累计耗时。 */
  long_task_duration_ms_total: number;
  /** long task 峰值。 */
  long_task_duration_ms_max: number;
}

const metricsByGeneration = new Map<string, GenerationMetrics>();
const METRICS_MAX_GENERATIONS = 50;

function ensureMetrics(generationId: string): GenerationMetrics {
  let m = metricsByGeneration.get(generationId);
  if (!m) {
    m = {
      generation_id: generationId,
      render_count_during_stream: 0,
      sse_reconnect_count: 0,
      long_task_duration_ms_total: 0,
      long_task_duration_ms_max: 0,
    };
    metricsByGeneration.set(generationId, m);
    // 防止无限增长：超出上限时淘汰最旧的 generation。
    if (metricsByGeneration.size > METRICS_MAX_GENERATIONS) {
      const oldest = metricsByGeneration.keys().next().value;
      if (oldest !== undefined) metricsByGeneration.delete(oldest);
    }
  }
  return m;
}

/**
 * 累积一条体验指标。聚合策略按指标类型：
 * - first_delta_latency_ms / finalize_to_stable_ms：仅记录首个值（一轮一次）。
 * - delta_to_paint_ms：记录最近值并维护峰值。
 * - render_count_during_stream / sse_reconnect_count：累加（increment）。
 * - long_task_duration_ms：累加 total 并维护 max。
 */
export function recordStreamingMetric(
  generationId: string,
  name: StreamingMetricName,
  value: number,
): void {
  const m = ensureMetrics(generationId);
  switch (name) {
    case "first_delta_latency_ms":
      if (m.first_delta_latency_ms === undefined) m.first_delta_latency_ms = value;
      break;
    case "finalize_to_stable_ms":
      if (m.finalize_to_stable_ms === undefined) m.finalize_to_stable_ms = value;
      break;
    case "delta_to_paint_ms":
      m.delta_to_paint_ms = value;
      m.delta_to_paint_ms_max = Math.max(m.delta_to_paint_ms_max ?? 0, value);
      break;
    case "render_count_during_stream":
      m.render_count_during_stream += value;
      break;
    case "sse_reconnect_count":
      m.sse_reconnect_count += value;
      break;
    case "long_task_duration_ms":
      m.long_task_duration_ms_total += value;
      m.long_task_duration_ms_max = Math.max(m.long_task_duration_ms_max, value);
      break;
  }
}

/** 读取某一轮 generation 的累积指标（返回副本）。 */
export function getStreamingMetrics(
  generationId: string,
): GenerationMetrics | undefined {
  const m = metricsByGeneration.get(generationId);
  return m ? { ...m } : undefined;
}

/** 清空所有累积指标（主要供测试隔离用例使用）。 */
export function clearStreamingMetrics(): void {
  metricsByGeneration.clear();
}

// ---------------------------------------------------------------------------
// 阈值常量（供调用方判断是否需要以 warning 记录）
// ---------------------------------------------------------------------------

export const STREAMING_THRESHOLDS = {
  /** delta→paint 超过此值（ms）记 delta_to_paint_slow。 */
  DELTA_TO_PAINT_MS: 200,
  /** long task 超过此值（ms）记 ui_long_task。 */
  LONG_TASK_MS: 100,
} as const;

// ---------------------------------------------------------------------------
// Long task 观测（PerformanceObserver，SSR / 不支持时安全降级）
// ---------------------------------------------------------------------------

/**
 * 启动 long task 观测。>LONG_TASK_MS 的任务记 `ui_long_task` 并累积
 * `long_task_duration_ms`。trace 通过 getTrace 动态获取（long task 与具体
 * generation 解耦，取当前活动 trace）。返回 cleanup；不支持时安全降级。
 */
export function startLongTaskObserver(
  getTrace: () => StreamingTrace | null,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof PerformanceObserver === "undefined"
  ) {
    return () => {};
  }

  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      const trace = getTrace();
      if (!trace) return;
      for (const entry of list.getEntries()) {
        const duration = entry.duration;
        if (duration <= STREAMING_THRESHOLDS.LONG_TASK_MS) continue;
        recordStreamingMetric(trace.generation_id, "long_task_duration_ms", duration);
        trackStreamingUIEvent({
          event_type: "ui_long_task",
          video_id: trace.video_id,
          generation_id: trace.generation_id,
          ui_session_id: trace.ui_session_id,
          active_level: trace.active_level,
          reason: `long_task ${Math.round(duration)}ms`,
        });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // 浏览器不支持 longtask entryType → 安全降级。
    return () => {};
  }

  return () => {
    try {
      observer?.disconnect();
    } catch {
      // ignore
    }
  };
}
