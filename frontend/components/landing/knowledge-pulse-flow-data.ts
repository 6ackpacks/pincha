export type PulseNode = {
  id: string;
  title: string;
  subtitle: string;
  logo: string;
  status?: string;
  pulseLabel?: string;
};

export type PulsePath = {
  id: string;
  d: string;
  mobileD: string;
  direction: "input" | "process" | "output";
  duration: number;
  delay: number;
  pulseLabels: string[];
  sourceId?: string;
  targetId?: string;
};

export const sources: PulseNode[] = [
  {
    id: "youtube",
    title: "YouTube 视频",
    subtitle: "字幕内容",
    logo: "youtube",
    status: "字幕提取中",
    pulseLabel: "视频字幕",
  },
  {
    id: "podcast",
    title: "Podcast 播客",
    subtitle: "音频转写",
    logo: "podcast",
    status: "语义拆解中",
    pulseLabel: "音频转写",
  },
  {
    id: "article",
    title: "Article 长文",
    subtitle: "正文提取",
    logo: "article",
    status: "内容结构化中",
    pulseLabel: "长文结构",
  },
  {
    id: "twitter",
    title: "X / Twitter 帖子",
    subtitle: "观点串联",
    logo: "x",
    status: "关键观点识别中",
    pulseLabel: "观点串联",
  },
];

export const processLabels = [
  "字幕提取中",
  "语义拆解中",
  "章节归并中",
  "关键观点识别中",
  "内容结构化中",
];

export const outputs: PulseNode[] = [
  {
    id: "levels",
    title: "分级摘要",
    subtitle: "逐层展开",
    logo: "levels",
    pulseLabel: "提取观点",
  },
  {
    id: "qa",
    title: "视频问答",
    subtitle: "随时提问",
    logo: "qa",
    pulseLabel: "可追溯引用",
  },
  {
    id: "mindmap",
    title: "思维导图",
    subtitle: "关系展开",
    logo: "mindmap",
    pulseLabel: "建立关系",
  },
  {
    id: "library",
    title: "知识库归档",
    subtitle: "长期沉淀",
    logo: "library",
    pulseLabel: "写入知识库",
  },
];

export const paths: PulsePath[] = [
  {
    id: "in-youtube",
    d: "M 332 170 C 370 168, 392 188, 420 226",
    mobileD: "M 132 108 C 190 140, 255 162, 500 212",
    direction: "input",
    duration: 5.2,
    delay: 0.1,
    pulseLabels: ["视频字幕"],
    sourceId: "youtube",
  },
  {
    id: "in-podcast",
    d: "M 332 230 C 372 232, 394 234, 420 244",
    mobileD: "M 312 108 C 356 138, 410 166, 500 212",
    direction: "input",
    duration: 4.7,
    delay: 1.0,
    pulseLabels: ["音频转写"],
    sourceId: "podcast",
  },
  {
    id: "in-article",
    d: "M 332 290 C 372 288, 394 274, 420 260",
    mobileD: "M 492 108 C 502 144, 500 172, 500 212",
    direction: "input",
    duration: 5.8,
    delay: 1.8,
    pulseLabels: ["长文结构"],
    sourceId: "article",
  },
  {
    id: "in-twitter",
    d: "M 332 350 C 372 350, 394 312, 420 278",
    mobileD: "M 672 108 C 628 140, 574 166, 500 212",
    direction: "input",
    duration: 5.1,
    delay: 2.7,
    pulseLabels: ["观点串联"],
    sourceId: "twitter",
  },
  {
    id: "process-loop-a",
    d: "M 448 222 C 498 178, 570 202, 562 256 C 554 314, 458 318, 438 266 C 428 242, 432 232, 448 222",
    mobileD: "M 430 260 C 470 226, 536 236, 564 274 C 590 310, 540 348, 490 336 C 440 324, 398 292, 430 260",
    direction: "process",
    duration: 5.6,
    delay: 0.7,
    pulseLabels: ["章节识别", "语义拆解"],
  },
  {
    id: "process-loop-b",
    d: "M 568 284 C 520 332, 430 312, 432 252 C 434 198, 514 178, 562 226 C 586 250, 588 266, 568 284",
    mobileD: "M 570 292 C 538 338, 458 348, 424 306 C 390 264, 436 224, 494 230 C 552 236, 602 250, 570 292",
    direction: "process",
    duration: 6,
    delay: 2.1,
    pulseLabels: ["重点提炼", "结构归并", "信息去噪"],
  },
  {
    id: "out-levels",
    d: "M 590 226 C 626 194, 650 168, 676 168",
    mobileD: "M 500 338 C 438 382, 358 392, 312 426",
    direction: "output",
    duration: 5.4,
    delay: 1.2,
    pulseLabels: ["提取观点"],
    targetId: "levels",
  },
  {
    id: "out-qa",
    d: "M 590 246 C 626 234, 650 230, 676 230",
    mobileD: "M 500 338 C 558 382, 626 394, 672 426",
    direction: "output",
    duration: 5.7,
    delay: 2.0,
    pulseLabels: ["可追溯引用"],
    targetId: "qa",
  },
  {
    id: "out-mindmap",
    d: "M 590 266 C 626 282, 650 292, 676 292",
    mobileD: "M 500 338 C 612 374, 784 384, 852 426",
    direction: "output",
    duration: 5.3,
    delay: 3.0,
    pulseLabels: ["建立关系"],
    targetId: "mindmap",
  },
  {
    id: "out-library",
    d: "M 590 286 C 626 326, 650 352, 676 352",
    mobileD: "M 500 338 C 672 360, 832 388, 852 500",
    direction: "output",
    duration: 6,
    delay: 4.0,
    pulseLabels: ["写入知识库"],
    targetId: "library",
  },
];
