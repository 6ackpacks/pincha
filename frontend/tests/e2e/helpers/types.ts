/**
 * Shared type definitions for E2E test mocks.
 * These mirror the interfaces from lib/api.ts.
 */

export interface VideoStatus {
  state: string
  progress: number
  message: string
}

export interface VideoResponse {
  id: string
  url: string
  platform: string
  title: string | null
  thumbnail_url: string | null
  duration: string | null
  status: VideoStatus
  in_wiki: boolean
  created_at: string
  show_name: string | null
  host: string | null
  description: string | null
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface TranscriptResponse {
  id: string
  video_id: string
  language: string
  source: string
  segments: TranscriptSegment[]
  segments_en: (TranscriptSegment | null)[] | null
  full_text: string
  created_at: string
}

export interface SummaryResponse {
  id: string
  video_id: string
  level: string
  content: string
  model_used: string
  created_at: string
  cached: boolean
}

export interface MindmapResponse {
  id: string
  video_id: string
  markdown: string
  model_used: string
  created_at: string
  cached: boolean
}
