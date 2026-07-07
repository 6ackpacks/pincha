/**
 * Static asset CDN helper.
 * Set NEXT_PUBLIC_CDN_BASE to rewrite frontend/public asset paths to a CDN.
 * Leave it empty to serve files from the local Next.js public directory.
 */
const CDN_BASE = (process.env.NEXT_PUBLIC_CDN_BASE || "").replace(/\/$/, "");

export function cdnUrl(path: string): string {
  if (!CDN_BASE) return path;
  // 已是绝对 URL（http/https/data）则不动
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
  return `${CDN_BASE}/${path.replace(/^\//, "")}`;
}
