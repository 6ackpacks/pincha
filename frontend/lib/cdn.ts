/**
 * 静态资源 CDN 地址构造。
 *
 * frontend/public 下的静态图（频道图、mascot、landing、brand、GIF 等）已上传
 * 到火山 TOS。配置 NEXT_PUBLIC_CDN_BASE 后，本函数把本地路径重写为 CDN 地址；
 * 未配置时原样返回本地路径（走 Next.js public），实现一键回退。
 *
 * 上传脚本（backend/scripts/upload_static_assets.py）默认前缀为 `static`，
 * 即 public/mascot/x.gif -> <bucket-or-cdn>/static/mascot/x.gif。
 * 因此 NEXT_PUBLIC_CDN_BASE 应配成 `<CDN_BASE>/static`（无尾斜杠），
 * 这样 cdnUrl("/mascot/x.gif") => "<CDN_BASE>/static/mascot/x.gif"。
 *
 * 用法：
 *   <img src={cdnUrl("/mascot/cha_star.gif")} />
 *   const COVERS = ["/channel-1.webp"].map(cdnUrl);
 *
 * 注意：仅用于 public 下的本地静态资源。后端返回的 thumbnail_url（YouTube 封面
 * 等远程图）由 proxyThumbnail 处理，不要经过本函数。
 */
const PRODUCTION_CDN_BASE = "https://pincha.tos-cn-beijing.volces.com/static";

const CDN_BASE = (
  process.env.NEXT_PUBLIC_CDN_BASE ||
  (process.env.NODE_ENV === "production" ? PRODUCTION_CDN_BASE : "")
).replace(/\/$/, "");

export function cdnUrl(path: string): string {
  if (!CDN_BASE) return path;
  // 已是绝对 URL（http/https/data）则不动
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
  return `${CDN_BASE}/${path.replace(/^\//, "")}`;
}
