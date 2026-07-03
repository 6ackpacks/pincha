/** 公开站点 URL，用于生成可外发的分享链接（如 OG 卡片嵌入地址）。 */
export const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const PUBLIC_SITE_HOST = (() => {
  try {
    return new URL(PUBLIC_SITE_URL).hostname;
  } catch {
    return "localhost";
  }
})();

export const VIDEO_STATES = {
  PENDING: "pending",
  DOWNLOADING: "downloading",
  TRANSCRIBING: "transcribing",
  SUMMARIZING: "summarizing",
  GENERATING_MINDMAP: "generating_mindmap",
  DONE: "done",
  FAILED: "failed",
} as const;

export type VideoState = (typeof VIDEO_STATES)[keyof typeof VIDEO_STATES];

export const STATE_LABELS: Record<string, string> = {
  [VIDEO_STATES.PENDING]: "排队中",
  [VIDEO_STATES.DOWNLOADING]: "下载中",
  [VIDEO_STATES.TRANSCRIBING]: "转录中",
  [VIDEO_STATES.SUMMARIZING]: "总结中",
  [VIDEO_STATES.GENERATING_MINDMAP]: "生成导图",
  [VIDEO_STATES.DONE]: "已完成",
  [VIDEO_STATES.FAILED]: "解析失败",
  fetching: "提取中",
  extracting: "提取中",
  compiling: "加入知识库中",
};

export const SUMMARY_LEVELS = [
  { key: "express", label: "速览", pct: "5%", desc: "一句话总结" },
  { key: "highlight", label: "精华", pct: "30%", desc: "核心要点" },
  { key: "detailed", label: "详述", pct: "60%", desc: "详细内容" },
  { key: "full", label: "全文", pct: "90%", desc: "完整记录" },
] as const;

export type SummaryLevel = (typeof SUMMARY_LEVELS)[number]["key"];

/** High-frequency UI labels — centralized for consistency and easy i18n. */
export const UI_LABELS = {
  // Processing states
  PROCESSING: "整理中",
  PROCESSING_DOTS: "整理中...",
  PROCESSING_LONG: "正在整理，请稍候",
  START_PROCESSING: "开始品读",
  REPROCESS: "重新整理",
  RETRYING: "重试中",
  COMPLETED: "品读完成",
  PROCESSING_FAILED: "整理失败",
  PROCESSING_ISSUE: "整理遇到问题",
  CONTENT_READY: "内容已整理好",
  QUEUE_ADDED: "已加入整理队列",
  QUEUE_PROCESSING: (n: number) => `${n} 条线索整理中`,

  // Actions
  SUBMIT: "提交",
  CANCEL: "取消",
  SAVE: "保存",
  DELETE: "删除",

  // Error messages
  ERROR_NETWORK: "网络连接失败，请稍后重试",
  ERROR_SUBMIT: "提交失败，请稍后重试",
  ERROR_INVALID_URL: "请输入完整的链接（需包含 http:// 或 https://）",
} as const;
