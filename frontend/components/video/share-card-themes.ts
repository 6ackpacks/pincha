"use client";

export type ShareCardThemeId = "mint" | "ink" | "citrus" | "night" | "paper";

export interface ShareCardTheme {
  id: ShareCardThemeId;
  name: string;
  shortName: string;
  description: string;
  shellBg: string;
  cardBg: string;
  headerBg: string;
  bodyBg: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  titleColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  hairline: string;
  chipBg: string;
  chipText: string;
  pointBg: string;
  numberBg: string;
  numberText: string;
  footerBg: string;
  footerText: string;
  footerMuted: string;
  markColor: string;
  swatch: string[];
}

export const SHARE_CARD_THEMES: Record<ShareCardThemeId, ShareCardTheme> = {
  mint: {
    id: "mint",
    name: "猹绿",
    shortName: "绿",
    description: "品牌默认，适合大多数知识摘要",
    shellBg: "#f2fbf7",
    cardBg: "#fbfffd",
    headerBg: "linear-gradient(135deg, #e7fff5 0%, #f8fffc 58%, #d9f7ea 100%)",
    bodyBg: "#fbfffd",
    accent: "#20b486",
    accentSoft: "#d9f7ea",
    accentText: "#08795c",
    titleColor: "#13231d",
    textColor: "#33443d",
    mutedColor: "#6a7a73",
    borderColor: "#bdebd9",
    hairline: "rgba(32, 180, 134, 0.18)",
    chipBg: "rgba(32, 180, 134, 0.12)",
    chipText: "#08795c",
    pointBg: "rgba(32, 180, 134, 0.055)",
    numberBg: "#20b486",
    numberText: "#ffffff",
    footerBg: "#0f8e69",
    footerText: "#ffffff",
    footerMuted: "rgba(255, 255, 255, 0.68)",
    markColor: "#20b486",
    swatch: ["#e7fff5", "#20b486", "#0f8e69"],
  },
  ink: {
    id: "ink",
    name: "深读蓝",
    shortName: "蓝",
    description: "冷静、理性，适合长视频深度解读",
    shellBg: "#f3f7ff",
    cardBg: "#fbfdff",
    headerBg: "linear-gradient(135deg, #e8f0ff 0%, #fbfdff 55%, #dce8ff 100%)",
    bodyBg: "#fbfdff",
    accent: "#3568d4",
    accentSoft: "#dce8ff",
    accentText: "#244f9f",
    titleColor: "#111b35",
    textColor: "#35415d",
    mutedColor: "#6a7388",
    borderColor: "#c8d8fb",
    hairline: "rgba(53, 104, 212, 0.18)",
    chipBg: "rgba(53, 104, 212, 0.12)",
    chipText: "#244f9f",
    pointBg: "rgba(53, 104, 212, 0.055)",
    numberBg: "#3568d4",
    numberText: "#ffffff",
    footerBg: "#1d3f8c",
    footerText: "#ffffff",
    footerMuted: "rgba(255, 255, 255, 0.68)",
    markColor: "#3568d4",
    swatch: ["#e8f0ff", "#3568d4", "#1d3f8c"],
  },
  citrus: {
    id: "citrus",
    name: "柑橘黄",
    shortName: "黄",
    description: "轻快醒目，适合产品观点和趋势洞察",
    shellBg: "#fff8e8",
    cardBg: "#fffdf7",
    headerBg: "linear-gradient(135deg, #fff2bd 0%, #fffdf7 54%, #ffe1a6 100%)",
    bodyBg: "#fffdf7",
    accent: "#e58922",
    accentSoft: "#ffe8be",
    accentText: "#965110",
    titleColor: "#25190d",
    textColor: "#493829",
    mutedColor: "#806d59",
    borderColor: "#f7d69f",
    hairline: "rgba(229, 137, 34, 0.22)",
    chipBg: "rgba(229, 137, 34, 0.14)",
    chipText: "#965110",
    pointBg: "rgba(229, 137, 34, 0.055)",
    numberBg: "#e58922",
    numberText: "#ffffff",
    footerBg: "#9d5b17",
    footerText: "#fff8ed",
    footerMuted: "rgba(255, 248, 237, 0.7)",
    markColor: "#e58922",
    swatch: ["#fff2bd", "#e58922", "#9d5b17"],
  },
  night: {
    id: "night",
    name: "夜读黑",
    shortName: "黑",
    description: "沉浸、克制，适合播客和晚间阅读",
    shellBg: "#111318",
    cardBg: "#15181f",
    headerBg: "linear-gradient(135deg, #20242e 0%, #15181f 58%, #0d1015 100%)",
    bodyBg: "#15181f",
    accent: "#76e0c0",
    accentSoft: "rgba(118, 224, 192, 0.12)",
    accentText: "#a2f1dc",
    titleColor: "#f7f8f6",
    textColor: "#d8ddd8",
    mutedColor: "#949b97",
    borderColor: "rgba(255, 255, 255, 0.12)",
    hairline: "rgba(255, 255, 255, 0.1)",
    chipBg: "rgba(118, 224, 192, 0.13)",
    chipText: "#a2f1dc",
    pointBg: "rgba(255, 255, 255, 0.045)",
    numberBg: "#76e0c0",
    numberText: "#0e1613",
    footerBg: "#0d1015",
    footerText: "#f7f8f6",
    footerMuted: "rgba(247, 248, 246, 0.56)",
    markColor: "#76e0c0",
    swatch: ["#15181f", "#76e0c0", "#0d1015"],
  },
  paper: {
    id: "paper",
    name: "清单白",
    shortName: "白",
    description: "干净留白，适合正式转发和工作群",
    shellBg: "#f6f5ef",
    cardBg: "#fffefa",
    headerBg: "linear-gradient(135deg, #fffefa 0%, #f4f0e6 100%)",
    bodyBg: "#fffefa",
    accent: "#2f2a22",
    accentSoft: "#ebe5d7",
    accentText: "#2f2a22",
    titleColor: "#201c16",
    textColor: "#4d463b",
    mutedColor: "#7c7466",
    borderColor: "#ded6c6",
    hairline: "rgba(47, 42, 34, 0.13)",
    chipBg: "#ebe5d7",
    chipText: "#2f2a22",
    pointBg: "rgba(47, 42, 34, 0.035)",
    numberBg: "#2f2a22",
    numberText: "#fffefa",
    footerBg: "#2f2a22",
    footerText: "#fffefa",
    footerMuted: "rgba(255, 254, 250, 0.62)",
    markColor: "#9a7b45",
    swatch: ["#fffefa", "#9a7b45", "#2f2a22"],
  },
};

export const SHARE_CARD_THEME_IDS = Object.keys(SHARE_CARD_THEMES) as ShareCardThemeId[];
