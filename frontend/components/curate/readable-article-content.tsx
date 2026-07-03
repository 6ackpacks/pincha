"use client";

import ReactMarkdown from "react-markdown";
import { ProseMirrorRenderer } from "./prosemirror-renderer";

function parseProseMirrorDoc(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.type === "doc" && Array.isArray(parsed.content)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizePlainText(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (/[#>*_\-[\]()`]|^\s*\d+\.\s/m.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function ReadableArticleContent({ content }: { content: string }) {
  const proseMirrorDoc = parseProseMirrorDoc(content);

  if (proseMirrorDoc) {
    return <ProseMirrorRenderer content={proseMirrorDoc} className="readable-article" />;
  }

  return (
    <article className="readable-article">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          p: ({ children }) => <p>{children}</p>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => <blockquote>{children}</blockquote>,
          img: ({ src, alt }) => <img src={src ?? ""} alt={alt ?? ""} loading="lazy" decoding="async" />,
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? <code className={className}>{children}</code> : <code>{children}</code>;
          },
          pre: ({ children }) => <pre>{children}</pre>,
        }}
      >
        {normalizePlainText(content)}
      </ReactMarkdown>
    </article>
  );
}
