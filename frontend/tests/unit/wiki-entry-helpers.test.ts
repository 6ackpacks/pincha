import { describe, expect, it } from "vitest";
import { normalizeWikiTarget, resolveWikiTargetSlug } from "@/components/knowledge/wiki-entry-helpers";

const pages = [
  { title: "跨学科策略知识图谱", slug: "跨学科策略知识图谱" },
  { title: "前瞻性构建", slug: "前瞻性构建" },
  { title: "AI Strategy", slug: "ai-strategy" },
];

describe("wiki entry link helpers", () => {
  it("normalizes encoded knowledge URLs into slugs", () => {
    expect(normalizeWikiTarget("/knowledge/%E5%89%8D%E7%9E%BB%E6%80%A7%E6%9E%84%E5%BB%BA"))
      .toBe("前瞻性构建");
  });

  it("keeps navigation on the explicit target for normal aliases", () => {
    expect(resolveWikiTargetSlug("AI Strategy", pages, { display: "策略", currentSlug: "跨学科策略知识图谱" }))
      .toBe("ai-strategy");
  });

  it("uses the displayed entry when an alias target would self-link to the current page", () => {
    expect(resolveWikiTargetSlug("跨学科策略知识图谱", pages, {
      display: "前瞻性构建",
      currentSlug: "跨学科策略知识图谱",
    })).toBe("前瞻性构建");
  });

  it("uses the displayed entry when the raw target cannot be resolved", () => {
    expect(resolveWikiTargetSlug("missing-target", pages, { display: "前瞻性构建" }))
      .toBe("前瞻性构建");
  });
});
