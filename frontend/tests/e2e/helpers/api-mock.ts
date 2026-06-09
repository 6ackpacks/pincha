import type { Page } from '@playwright/test'
import type {
  VideoResponse,
  VideoStatus,
  SummaryResponse,
  TranscriptSegment,
  TranscriptResponse,
  MindmapResponse,
} from './types'

/**
 * Mock the video list API endpoint.
 */
export async function mockVideoList(page: Page, videos: VideoResponse[]) {
  await page.route('**/api/v1/videos', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(videos),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Mock the video detail API endpoint.
 */
export async function mockVideoDetail(page: Page, id: string, data: VideoResponse) {
  await page.route(`**/api/v1/videos/${id}`, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Mock the video submission (POST /api/v1/videos).
 */
export async function mockVideoSubmit(page: Page, response: VideoResponse) {
  await page.route('**/api/v1/videos', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Mock the video progress endpoint.
 */
export async function mockVideoProgress(page: Page, id: string, status: VideoStatus) {
  await page.route(`**/api/v1/videos/${id}/progress`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(status),
    })
  })
}

/**
 * Mock the summary response for a specific video and level.
 */
export async function mockSummaryResponse(
  page: Page,
  id: string,
  level: string,
  content: string
) {
  await page.route(`**/api/v1/videos/${id}/summary/${level}`, (route) => {
    const response: SummaryResponse = {
      id: `summary-${level}-${id}`,
      video_id: id,
      level,
      content,
      model_used: 'gpt-4o-mini',
      created_at: new Date().toISOString(),
      cached: true,
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    })
  })
}

/**
 * Mock the available summary levels endpoint.
 */
export async function mockAvailableSummaryLevels(page: Page, id: string, levels: string[]) {
  await page.route(`**/api/v1/videos/${id}/summary/available`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(levels),
    })
  })
}

/**
 * Mock the transcript endpoint for a video.
 */
export async function mockTranscript(page: Page, id: string, segments: TranscriptSegment[]) {
  const response: TranscriptResponse = {
    id: `transcript-${id}`,
    video_id: id,
    language: 'zh',
    source: 'platform',
    segments,
    segments_en: null,
    full_text: segments.map((s) => s.text).join(' '),
    created_at: new Date().toISOString(),
  }
  await page.route(`**/api/v1/videos/${id}/transcript`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    })
  })
}

/**
 * Mock the mindmap endpoint for a video.
 */
export async function mockMindmap(page: Page, id: string, markdown: string) {
  const response: MindmapResponse = {
    id: `mindmap-${id}`,
    video_id: id,
    markdown,
    model_used: 'gpt-4o-mini',
    created_at: new Date().toISOString(),
    cached: true,
  }
  await page.route(`**/api/v1/videos/${id}/mindmap`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    })
  })
}

/**
 * Mock the wiki ask streaming endpoint (returns a simple text stream).
 */
export async function mockWikiAskStream(page: Page, responseText: string) {
  await page.route('**/api/v1/wiki/ask', (route) => {
    const encoder = new TextEncoder()
    const body = encoder.encode(responseText)
    route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from(body),
    })
  })
}

/**
 * Mock the video chat streaming endpoint.
 */
export async function mockVideoChatStream(page: Page, id: string, responseText: string) {
  await page.route(`**/api/v1/videos/${id}/ask`, (route) => {
    const encoder = new TextEncoder()
    const body = encoder.encode(responseText)
    route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from(body),
    })
  })
}

/**
 * Mock the popular videos endpoint.
 */
export async function mockPopularVideos(page: Page, videos: VideoResponse[]) {
  await page.route('**/api/v1/videos/popular*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(videos),
    })
  })
}

/**
 * Mock the trending videos endpoint.
 */
export async function mockTrendingVideos(page: Page, videos: VideoResponse[]) {
  await page.route('**/api/v1/videos/trending*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(videos),
    })
  })
}
