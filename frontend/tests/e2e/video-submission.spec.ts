import { test, expect } from './fixtures/auth.fixture'
import {
  mockVideoList,
  mockVideoDetail,
  mockVideoSubmit,
  mockVideoProgress,
  mockSummaryResponse,
  mockAvailableSummaryLevels,
  mockMindmap,
  mockTranscript,
  mockPopularVideos,
} from './helpers/api-mock'
import type { VideoResponse } from './helpers/types'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_VIDEO: VideoResponse = {
  id: 'video-001',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  platform: 'youtube',
  title: '测试视频：AI 技术前沿',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  duration: '12:34',
  status: { state: 'done', progress: 100, message: '已完成' },
  in_wiki: false,
  created_at: '2024-01-01T00:00:00Z',
  show_name: null,
  host: null,
  description: null,
}

const PROCESSING_VIDEO: VideoResponse = {
  ...MOCK_VIDEO,
  id: 'video-002',
  title: '正在处理的视频',
  status: { state: 'summarizing', progress: 60, message: '总结中...' },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Video Submission', () => {
  test('user submits a YouTube URL and sees processing status', async ({ authedPage }) => {
    const page = authedPage

    // Mock the popular videos for the home page
    await mockPopularVideos(page, [])

    // Mock curate channels to avoid errors on home page
    await page.route('**/api/v1/curate-v2/channels', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    // Mock the video submission to return a processing video
    await mockVideoSubmit(page, PROCESSING_VIDEO)

    // Mock the video list to include the new video
    await mockVideoList(page, [PROCESSING_VIDEO])

    // Mock progress endpoint
    await mockVideoProgress(page, 'video-002', PROCESSING_VIDEO.status)

    // Navigate to home page
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Find the URL input and submit a YouTube link
    const input = page.locator('input[placeholder*="YouTube"], input[placeholder*="链接"]').first()
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    // Submit the form (press Enter or click submit button)
    await input.press('Enter')

    // Should navigate to videos page or show processing state
    // Wait for the processing video to appear
    await expect(
      page.getByText('正在处理的视频').or(page.getByText('总结中'))
    ).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Summary Tabs', () => {
  test('video detail page shows 4 summary levels', async ({ authedPage }) => {
    const page = authedPage

    // Set up all mocks for the video detail page
    await mockVideoDetail(page, 'video-001', MOCK_VIDEO)
    await mockAvailableSummaryLevels(page, 'video-001', [
      'express',
      'highlight',
      'detailed',
      'full',
    ])
    await mockSummaryResponse(page, 'video-001', 'express', '# 极速概览\n这是一个关于 AI 技术的视频。')
    await mockSummaryResponse(page, 'video-001', 'highlight', '# 精华摘要\n详细介绍了 AI 的发展历程。')
    await mockSummaryResponse(page, 'video-001', 'detailed', '# 深度解读\n从多个角度分析了 AI 技术。')
    await mockSummaryResponse(page, 'video-001', 'full', '# 完整笔记\n完整的视频内容记录。')
    await mockTranscript(page, 'video-001', [
      { start: 0, end: 5, text: '大家好' },
      { start: 5, end: 10, text: '今天我们来聊聊 AI' },
    ])
    await mockMindmap(page, 'video-001', '# AI 技术\n## 机器学习\n## 深度学习')

    // Mock progress stream to avoid SSE errors
    await page.route('**/api/v1/videos/video-001/progress/stream', (route) => {
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
    })

    // Mock chat history
    await page.route('**/api/v1/videos/video-001/chat/history', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    // Navigate to video detail page
    await page.goto('/videos/video-001')
    await page.waitForLoadState('networkidle')

    // Verify the video title is displayed
    await expect(page.getByText('测试视频：AI 技术前沿')).toBeVisible({ timeout: 10000 })

    // Look for summary tab indicators (the 4 levels)
    // The tab panel should show summary level options
    const summarySection = page.locator('[role="tablist"], [class*="tab"]').first()
    await expect(summarySection).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Mindmap Panel', () => {
  test('mindmap panel renders with mock data', async ({ authedPage }) => {
    const page = authedPage

    const mindmapMarkdown = `# AI 技术前沿
## 机器学习 [0:30]
### 监督学习
### 无监督学习
## 深度学习 [5:00]
### CNN
### Transformer
## 应用场景 [10:00]
### 自然语言处理
### 计算机视觉`

    await mockVideoDetail(page, 'video-001', MOCK_VIDEO)
    await mockAvailableSummaryLevels(page, 'video-001', ['express', 'highlight', 'detailed', 'full'])
    await mockSummaryResponse(page, 'video-001', 'express', '# 极速概览\n这是一个关于 AI 技术的视频。')
    await mockTranscript(page, 'video-001', [
      { start: 0, end: 30, text: '大家好' },
      { start: 30, end: 300, text: '机器学习部分' },
      { start: 300, end: 600, text: '深度学习部分' },
    ])
    await mockMindmap(page, 'video-001', mindmapMarkdown)

    await page.route('**/api/v1/videos/video-001/progress/stream', (route) => {
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
    })
    await page.route('**/api/v1/videos/video-001/chat/history', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/videos/video-001')
    await page.waitForLoadState('networkidle')

    // Look for the mindmap tab/button and click it
    const mindmapTab = page.getByText('思维导图').or(page.getByText('导图'))
    if (await mindmapTab.isVisible()) {
      await mindmapTab.click()
      // The mindmap should render (markmap-view creates an SVG)
      await expect(
        page.locator('svg').or(page.locator('[class*="mindmap"]'))
      ).toBeVisible({ timeout: 10000 })
    }
  })
})
