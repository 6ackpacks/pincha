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
  compiling: "编译中",
};

export const SUMMARY_LEVELS = [
  { key: "express", label: "速览", pct: "5%", desc: "一句话总结" },
  { key: "highlight", label: "精华", pct: "30%", desc: "核心要点" },
  { key: "detailed", label: "详述", pct: "60%", desc: "详细内容" },
  { key: "full", label: "全文", pct: "90%", desc: "完整记录" },
] as const;

export type SummaryLevel = (typeof SUMMARY_LEVELS)[number]["key"];
