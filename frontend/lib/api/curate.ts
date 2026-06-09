import { request } from "./client";

// ============================
// Curate V2 Module
// ============================

export interface CurateV2Channel {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  pick_count: number;
  is_active: boolean;
  sort_order: number;
  is_subscribed: boolean;
  subscription_id: number | null;
}

export interface CurateV2Pick {
  id: number;
  channel_id: number;
  pick_date: string;
  rank: number;
  source_type: string;
  source_id: number;
  title: string;
  summary: string | null;
  author_name: string | null;
  author_avatar: string | null;
  original_url: string;
  published_at: string | null;
  score: number | null;
  is_official: boolean;
  created_at: string;
  // Enriched by frontend from channel context
  channel_slug?: string;
  channel_name?: string;
}

export interface CurateV2ChannelPicks {
  channel: CurateV2Channel;
  picks: CurateV2Pick[];
  pick_date: string;
}

export interface CurateV2Feed {
  date: string;
  channels: CurateV2ChannelPicks[];
}

export interface CurateV2Subscription {
  id: number;
  user_id: string;
  channel_id: number;
  email_enabled: boolean;
  email_address: string | null;
  site_enabled: boolean;
  subscribed_at: string;
}

export interface UnreadCount {
  count: number;
}

export function getCurateV2Channels() {
  return request<CurateV2Channel[]>("/api/v1/curate-v2/channels");
}

export function getCurateV2ChannelPicks(slug: string, date?: string) {
  const params = date ? `?date=${date}` : "";
  return request<CurateV2ChannelPicks>(`/api/v1/curate-v2/channels/${slug}/picks${params}`);
}

export function getCurateV2Feed(date?: string) {
  const params = date ? `?date=${date}` : "";
  return request<CurateV2Feed>(`/api/v1/curate-v2/feed${params}`);
}

export function subscribeCurateV2Channel(channelId: number, emailEnabled = false, emailAddress?: string) {
  return request<CurateV2Subscription>(`/api/v1/curate-v2/channels/${channelId}/subscribe`, {
    method: "POST",
    body: JSON.stringify({ email_enabled: emailEnabled, email_address: emailAddress, site_enabled: true }),
  });
}

export function unsubscribeCurateV2Channel(channelId: number) {
  return request<void>(`/api/v1/curate-v2/channels/${channelId}/subscribe`, {
    method: "DELETE",
  });
}

export function getCurateV2UnreadCount() {
  return request<UnreadCount>("/api/v1/curate-v2/notifications/unread-count");
}

export interface DeepAnalyzeResult {
  article_id: string;
  status: string;
  message: string;
}

export function triggerDeepAnalyze(pickId: number) {
  return request<DeepAnalyzeResult>(`/api/v1/curate-v2/picks/${pickId}/deep-analyze`, {
    method: "POST",
  });
}

export interface PickDetail {
  id: number;
  channel_id: number;
  channel_slug: string | null;
  channel_name: string | null;
  pick_date: string;
  rank: number;
  source_type: string;
  source_id: number;
  title: string;
  summary: string | null;
  author_name: string | null;
  author_avatar: string | null;
  original_url: string;
  published_at: string | null;
  score: number | null;
  is_official: boolean;
  raw_content: string | null;
  article_id: string | null;
  created_at: string | null;
}

export function getPickDetail(pickId: number) {
  return request<PickDetail>(`/api/v1/curate-v2/picks/${pickId}`);
}

export interface ProductDetail {
  id: number;
  slug: string;
  name: string;
  slogan: string | null;
  description: string | null;
  description_json: Record<string, unknown> | string | null;
  organization: string | null;
  avatar_url: string | null;
  image_url: string | null;
  images: string | string[] | null;
  website_url: string | null;
  categories: Array<{ id: number; name: string }> | null;
  stats: { score: number; review_count: number; upvotes: number; stars?: number } | null;
  tag: unknown | null;
  create_at: string | null;
}

export interface ProductReview {
  id: number;
  user_name: string | null;
  user_avatar: string | null;
  vote_value: number;
  content_text: string;
  images: string | null;
  create_at: string | null;
}

export function getProductDetail(slug: string) {
  return request<ProductDetail>(`/api/v1/curate-v2/products/${slug}`);
}

export function getProductReviews(productId: number, limit = 5) {
  return request<{ reviews: ProductReview[]; total: number }>(
    `/api/v1/curate-v2/products/${productId}/reviews?limit=${limit}`
  );
}


