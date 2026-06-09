"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { ProseMirrorRenderer } from "@/components/curate/prosemirror-renderer";
import { Sidebar } from "@/components/layout/sidebar";
import {
  getPickDetail,
  getProductDetail,
  getProductReviews,
  triggerDeepAnalyze,
  type PickDetail,
  type ProductDetail,
  type ProductReview,
} from "@/lib/api";
import { cn, stripMarkdown } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  SealCheck,
  Sparkle,
  WarningCircle,
  Package,
} from "@phosphor-icons/react";

const CHANNEL_COLORS: Record<string, string> = {
  "ai-product-launch": "bg-violet-50 text-violet-600 border-violet-100",
  "ai-tutorial": "bg-sky-50 text-sky-600 border-sky-100",
  "ai-product-insight": "bg-emerald-50 text-emerald-600 border-emerald-100",
  "ai-deep-read": "bg-amber-50 text-amber-600 border-amber-100",
  "ai-daily-brief": "bg-rose-50 text-rose-600 border-rose-100",
};

export default function PickPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const pickId = Number(params.pickId);

  const { data: pick, isLoading, error } = useQuery({
    queryKey: ["pick-detail", pickId],
    queryFn: () => getPickDetail(pickId),
    enabled: !!pickId,
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/curate");
    }
  };

  if (isLoading) return <PreviewSkeleton />;
  if (error || !pick) return <PreviewError onBack={handleBack} />;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto bg-white">
        <div className="max-w-3xl mx-auto px-8 py-8">
          {/* Back button */}
          <button
            onClick={handleBack}
            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all mb-6"
          >
            <ArrowLeft size={14} weight="bold" className="transition-transform group-hover:-translate-x-0.5" />
            返回列表
          </button>

          {/* Header */}
          <PreviewHeader pick={pick} />

          {/* Content body */}
          <PreviewBody pick={pick} />

          {/* Action bar */}
          <PreviewActions pick={pick} />
        </div>
      </main>
    </div>
  );
}

function PreviewHeader({ pick }: { pick: PickDetail }) {
  const channelColor = CHANNEL_COLORS[pick.channel_slug ?? ""] ?? "bg-zinc-50 text-zinc-600 border-zinc-100";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Channel tag + date */}
      <div className="flex items-center gap-2 mb-3">
        {pick.channel_name && (
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", channelColor)}>
            {pick.channel_name}
          </span>
        )}
        {pick.published_at && (
          <span className="text-[11px] text-zinc-400">
            {new Date(pick.published_at).toLocaleDateString("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Title */}
      <h1 className="text-xl font-bold text-zinc-900 leading-tight mb-3">
        {stripMarkdown(pick.title)}
        {pick.is_official && (
          <SealCheck size={16} weight="fill" className="inline ml-2 text-blue-500" />
        )}
      </h1>

      {/* Author */}
      {pick.author_name && (
        <div className="flex items-center gap-2 mb-4">
          {pick.author_avatar ? (
            <img src={pick.author_avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-zinc-200" />
          )}
          <span className="text-sm text-zinc-600 font-medium">{pick.author_name}</span>
        </div>
      )}

      {/* Summary */}
      {pick.summary && (
        <div className="bg-zinc-50 border border-zinc-100 rounded-lg px-4 py-3 mb-6">
          <p className="text-sm text-zinc-600 leading-relaxed">{pick.summary}</p>
        </div>
      )}
    </motion.div>
  );
}

function PreviewBody({ pick }: { pick: PickDetail }) {
  const isProduct = pick.source_type === "product";

  // Product with no raw_content: show product card
  if (isProduct && !pick.raw_content) {
    return <ProductCard pick={pick} />;
  }

  // Non-product with no raw_content
  if (!pick.raw_content) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="border border-zinc-100 rounded-xl p-6 mb-6"
      >
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Package size={24} weight="bold" className="text-zinc-200 mb-2" />
          <p className="text-sm text-zinc-500 font-medium">暂无正文内容</p>
          <p className="text-xs text-zinc-400 mt-1">点击下方“查看原文”阅读完整内容</p>
        </div>
      </motion.div>
    );
  }

  // Try to parse raw_content as ProseMirror JSON
  let proseMirrorDoc: Record<string, unknown> | null = null;
  if (pick.raw_content) {
    try {
      const parsed = JSON.parse(pick.raw_content);
      if (parsed && typeof parsed === "object" && parsed.type === "doc" && Array.isArray(parsed.content)) {
        proseMirrorDoc = parsed;
      }
    } catch {
      // Not JSON, will render as markdown
    }
  }

  // Render with ProseMirror renderer if JSON, otherwise fallback to react-markdown
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="border border-zinc-100 rounded-xl p-6 mb-6"
    >
      {proseMirrorDoc ? (
        <ProseMirrorRenderer content={proseMirrorDoc as any} />
      ) : (
        <article className="prose prose-sm prose-zinc max-w-none">
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h2 className="text-base font-bold text-zinc-800 mt-4 mb-2">{children}</h2>
              ),
              h2: ({ children }) => (
                <h3 className="text-sm font-bold text-zinc-700 mt-3 mb-1.5">{children}</h3>
              ),
              h3: ({ children }) => (
                <h4 className="text-sm font-semibold text-zinc-700 mt-2 mb-1">{children}</h4>
              ),
              p: ({ children }) => (
                <p className="text-sm text-zinc-600 leading-relaxed mb-3">{children}</p>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-500 hover:text-emerald-600 underline break-all"
                >
                  {children}
                </a>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-4 space-y-1 mb-3">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-4 space-y-1 mb-3">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="text-sm text-zinc-600 leading-relaxed">{children}</li>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-zinc-800">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="italic text-zinc-600">{children}</em>
              ),
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <code className="block bg-zinc-50 border border-zinc-100 rounded-lg p-3 text-xs text-zinc-700 overflow-x-auto my-3 font-mono">
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="bg-zinc-100 text-zinc-700 px-1 py-0.5 rounded text-xs font-mono">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-zinc-50 border border-zinc-100 rounded-lg p-3 overflow-x-auto my-3">
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-zinc-200 pl-3 my-3 text-zinc-500 italic">
                  {children}
                </blockquote>
              ),
              img: ({ src, alt }) => (
                <img
                  src={src}
                  alt={alt || ""}
                  className="rounded-lg max-w-full h-auto my-3 border border-zinc-100"
                />
              ),
            }}
          >
            {pick.raw_content}
          </ReactMarkdown>
        </article>
      )}
    </motion.div>
  );
}

function ProductCard({ pick }: { pick: PickDetail }) {
  // Extract slug from original_url: https://watcha.cn/products/{slug}
  const slug = pick.original_url?.split("/products/")[1] || String(pick.source_id);

  const { data: product, isLoading } = useQuery({
    queryKey: ["product-detail", slug],
    queryFn: () => getProductDetail(slug),
    enabled: !!slug,
  });

  const { data: reviewsData } = useQuery({
    queryKey: ["product-reviews", product?.id],
    queryFn: () => getProductReviews(product!.id, 3),
    enabled: !!product?.id,
  });

  // Safely parse description_json — handles string, double-serialized string, or object
  const descContent = useMemo(() => {
    if (!product?.description_json) return null;
    let doc = product.description_json;
    if (typeof doc === "string") {
      try { doc = JSON.parse(doc); } catch { return null; }
    }
    if (typeof doc === "string") {
      try { doc = JSON.parse(doc); } catch { return null; }
    }
    if (!doc || typeof doc !== "object") return null;
    return doc as Record<string, unknown>;
  }, [product?.description_json]);

  // Parse images field (could be semicolon-separated string or array)
  const imageList: string[] = useMemo(() => {
    const raw = product?.images;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === "string") return raw.split(";").map((s) => s.trim()).filter(Boolean);
    return [];
  }, [product?.images]);

  if (isLoading) {
    return (
      <div className="mb-6">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-100" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-1/3 bg-zinc-100 rounded" />
              <div className="h-3 w-1/2 bg-zinc-100 rounded" />
            </div>
          </div>
          <div className="h-20 bg-zinc-50 rounded" />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="mb-6"
    >
      {/* 1. Top: Logo + Name + Org + Slogan */}
      <div className="flex items-start gap-4 mb-4">
        {(product?.avatar_url || pick.author_avatar) && (
          <img
            src={product?.avatar_url || pick.author_avatar || ""}
            alt={product?.name || pick.title}
            className="w-16 h-16 rounded-2xl object-cover border border-zinc-100 shadow-sm shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-900">
              {product?.name || pick.title}
            </h2>
            {pick.is_official && (
              <SealCheck size={18} weight="fill" className="text-blue-500 shrink-0" />
            )}
          </div>
          {product?.organization && (
            <p className="text-sm text-zinc-400 mt-0.5">@{product.organization}</p>
          )}
        </div>
      </div>

      {/* Slogan */}
      {(product?.slogan || pick.summary) && (
        <div className="border-l-3 border-zinc-200 pl-3 mb-5">
          <p className="text-sm text-zinc-500 leading-relaxed">
            {product?.slogan || pick.summary}
          </p>
        </div>
      )}

      {/* 2. Product description (no title wrapper, natural flow) */}
      {(descContent || product?.description) && (
        <div className="mb-5">
          {descContent ? (
            <ProseMirrorRenderer content={descContent} />
          ) : (
            <p className="text-sm text-zinc-600 leading-relaxed whitespace-pre-line">
              {product!.description}
            </p>
          )}
        </div>
      )}

      {/* 3. Product screenshots (horizontal scroll) */}
      {imageList.length > 0 && (
        <div className="mb-5 -mx-2">
          <div className="flex gap-3 overflow-x-auto px-2 pb-2">
            {imageList.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`${product?.name || pick.title} screenshot ${idx + 1}`}
                className="h-[200px] w-auto rounded-xl border border-zinc-100 object-cover shrink-0"
              />
            ))}
          </div>
        </div>
      )}

      {/* 4. Category tags */}
      {product?.categories && product.categories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-5">
          {product.categories.map((cat, idx) => (
            <span key={cat.id} className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400 px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                {cat.name}
              </span>
              {idx < product.categories!.length - 1 && (
                <span className="text-zinc-300 text-xs">&middot;</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Website link */}
      {product?.website_url && (
        <div className="mb-5">
          <a
            href={product.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
          >
            <ArrowSquareOut size={14} weight="bold" />
            访问产品官网
          </a>
        </div>
      )}

      {/* 5. User reviews */}
      {reviewsData && reviewsData.reviews.length > 0 && (
        <div className="border-t border-zinc-100 pt-5">
          <h3 className="text-sm font-bold text-zinc-700 mb-4">用户评价</h3>
          <div className="space-y-4">
            {reviewsData.reviews.slice(0, 3).map((review) => (
              <div key={review.id} className="flex items-start gap-3">
                {review.user_avatar ? (
                  <img
                    src={review.user_avatar}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-zinc-200 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-zinc-700">
                      {review.user_name}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                        review.vote_value === 1
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-red-50 text-red-500"
                      )}
                    >
                      {review.vote_value === 1 ? "推荐" : "不推荐"}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-500 leading-relaxed line-clamp-3">
                    {review.content_text}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* 6. "View all reviews" link */}
          {reviewsData.total > 3 && (
            <a
              href={pick.original_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-4 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
            >
              查看全部 {reviewsData.total} 条评价 &rarr;
            </a>
          )}
        </div>
      )}
    </motion.div>
  );
}

function PreviewActions({ pick }: { pick: PickDetail }) {
  const [importState, setImportState] = useState<"idle" | "loading" | "success" | "error">(
    pick.article_id ? "success" : "idle"
  );

  const importMut = useMutation({
    mutationFn: () => triggerDeepAnalyze(pick.id),
    onSuccess: () => setImportState("success"),
    onError: () => {
      setImportState("error");
      setTimeout(() => setImportState("idle"), 3000);
    },
  });

  const handleImport = () => {
    if (importState === "loading" || importState === "success") return;
    setImportState("loading");
    importMut.mutate();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="flex items-center gap-3 pt-4 border-t border-zinc-100"
    >
      {/* View original */}
      <a
        href={pick.original_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
      >
        <ArrowSquareOut size={15} weight="bold" />
        查看原文
      </a>

      {/* Import to knowledge base */}
      <button
        onClick={handleImport}
        disabled={importState === "loading" || importState === "success"}
        className={cn(
          "flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold transition-colors",
          importState === "success"
            ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
            : importState === "error"
              ? "bg-red-50 text-red-600 border border-red-200"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
        )}
      >
        {importState === "loading" ? (
          <><CircleNotch size={15} className="animate-spin" />收录中...</>
        ) : importState === "success" ? (
          <><CheckCircle size={15} weight="bold" />已收进知识库</>
        ) : importState === "error" ? (
          <><WarningCircle size={15} weight="bold" />收录失败</>
        ) : (
          <><Sparkle size={15} weight="bold" />收进知识库</>
        )}
      </button>

      {/* If already imported, show link to article */}
      {pick.article_id && (
        <Link
          href={`/articles/${pick.article_id}`}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
        >
          查看整理结果 →
        </Link>
      )}
    </motion.div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto bg-white">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="h-4 w-16 bg-zinc-100 rounded mb-6 animate-pulse" />
          <div className="h-3 w-24 bg-zinc-100 rounded mb-3 animate-pulse" />
          <div className="h-6 w-3/4 bg-zinc-100 rounded mb-3 animate-pulse" />
          <div className="h-4 w-1/3 bg-zinc-100 rounded mb-6 animate-pulse" />
          <div className="h-20 bg-zinc-50 rounded-lg mb-6 animate-pulse" />
          <div className="space-y-3">
            <div className="h-4 bg-zinc-50 rounded animate-pulse" />
            <div className="h-4 bg-zinc-50 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-zinc-50 rounded animate-pulse w-4/6" />
          </div>
        </div>
      </main>
    </div>
  );
}

function PreviewError({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-y-auto bg-white">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <WarningCircle size={32} weight="bold" className="text-zinc-200 mb-3" />
            <p className="text-sm font-semibold text-zinc-500">内容加载失败</p>
            <button
              onClick={onBack}
              className="group mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-zinc-500 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
            >
              <ArrowLeft size={14} weight="bold" className="transition-transform group-hover:-translate-x-0.5" />
              返回列表
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
