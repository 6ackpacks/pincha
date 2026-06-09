"use client";

import { useMemo } from "react";

interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

interface Props {
  content: unknown;
  className?: string;
}

export function ProseMirrorRenderer({ content, className }: Props) {
  const html = useMemo(() => {
    try {
      let doc = content;
      // Parse string content (handles single or double serialization)
      if (typeof doc === "string") {
        doc = JSON.parse(doc);
      }
      if (typeof doc === "string") {
        doc = JSON.parse(doc);
      }
      if (!doc || typeof doc !== "object") return null;
      const node = doc as ProseMirrorNode;
      // Support both { type: "doc", content: [...] } and bare { content: [...] }
      if (!node.content && !("type" in node)) return null;
      if (node.content) {
        return renderNodes(node.content);
      }
      return null;
    } catch (e) {
      console.warn("ProseMirror render error:", e);
      return null;
    }
  }, [content]);

  if (!html) return null;

  return (
    <article
      className={`pm-content ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderNodes(nodes: ProseMirrorNode[]): string {
  return nodes.map(renderNode).join("");
}

function renderNode(node: ProseMirrorNode): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${renderInline(node.content)}</p>`;

    case "heading": {
      const level = Math.min((node.attrs?.level as number) || 2, 4);
      return `<h${level}>${renderInline(node.content)}</h${level}>`;
    }

    case "bulletList":
      return `<ul>${renderNodes(node.content || [])}</ul>`;

    case "orderedList":
      return `<ol>${renderNodes(node.content || [])}</ol>`;

    case "listItem":
      return `<li>${renderNodes(node.content || [])}</li>`;

    case "blockquote":
      return `<blockquote>${renderNodes(node.content || [])}</blockquote>`;

    case "codeBlock": {
      const code = renderInline(node.content);
      return `<pre><code>${code}</code></pre>`;
    }

    case "image": {
      const src = node.attrs?.src as string;
      const alt = (node.attrs?.alt as string) || "";
      return src ? `<img src="${esc(src)}" alt="${esc(alt)}" />` : "";
    }

    case "figure": {
      const src = node.attrs?.src as string;
      if (src) return `<figure><img src="${esc(src)}" alt="" /></figure>`;
      return `<figure>${renderNodes(node.content || [])}</figure>`;
    }

    case "horizontalRule":
      return "<hr />";

    case "hardBreak":
      return "<br />";

    case "mention": {
      const label = node.attrs?.label as string;
      return label ? `<span class="mention">#${esc(label)}</span>` : "";
    }

    default:
      if (node.content) return renderNodes(node.content);
      if (node.text) return esc(node.text);
      return "";
  }
}

function renderInline(nodes?: ProseMirrorNode[]): string {
  if (!nodes) return "";
  return nodes.map((node) => {
    if (node.type === "text") return renderText(node);
    if (node.type === "hardBreak") return "<br />";
    if (node.type === "mention") {
      const label = node.attrs?.label as string;
      return label ? `<span class="mention">#${esc(label)}</span>` : "";
    }
    if (node.type === "image") {
      const src = node.attrs?.src as string;
      return src ? `<img src="${esc(src)}" alt="" class="inline-img" />` : "";
    }
    if (node.content) return renderNodes(node.content);
    return "";
  }).join("");
}

const SAFE_URL_PATTERN = /^(https?:\/\/|mailto:)/i;

function renderText(node: ProseMirrorNode): string {
  let html = esc(node.text || "");
  if (node.marks) {
    for (const mark of node.marks) {
      switch (mark.type) {
        case "bold":
        case "strong":
          html = `<strong>${html}</strong>`;
          break;
        case "italic":
        case "em":
          html = `<em>${html}</em>`;
          break;
        case "underline":
          html = `<u>${html}</u>`;
          break;
        case "strike":
          html = `<s>${html}</s>`;
          break;
        case "code":
          html = `<code>${html}</code>`;
          break;
        case "link": {
          const rawHref = (mark.attrs?.href as string) || "";
          const href = SAFE_URL_PATTERN.test(rawHref) ? esc(rawHref) : "#";
          html = `<a href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`;
          break;
        }
        case "highlight":
          html = `<mark>${html}</mark>`;
          break;
      }
    }
  }
  return html;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
