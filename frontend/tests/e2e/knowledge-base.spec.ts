import { test, expect } from './fixtures/auth.fixture'
import { mockWikiAskStream } from './helpers/api-mock'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Knowledge Base - RAG Chat', () => {
  test('user sends a question and receives a streamed reply', async ({ authedPage }) => {
    const page = authedPage

    // Mock the wiki pages list
    await page.route('**/api/v1/wiki/pages*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'page-001',
            title: '机器学习基础',
            slug: 'machine-learning-basics',
            type: 'concept',
            summary: '机器学习是人工智能的一个分支',
            source_count: 3,
            status: 'published',
            has_contradiction: false,
            community_id: null,
            tags: ['AI', '机器学习'],
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]),
      })
    })

    // Mock wiki tags
    await page.route('**/api/v1/wiki/tags', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    // Mock wiki articles
    await page.route('**/api/v1/wiki/articles', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    // Mock wiki videos
    await page.route('**/api/v1/wiki/videos', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    // Mock KB list
    await page.route('**/api/v1/kbs', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'kb-001',
            name: '默认知识库',
            description: null,
            is_default: true,
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      })
    })

    // Mock conversations
    await page.route('**/api/v1/kbs/*/conversations', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    // Mock wiki quota
    await page.route('**/api/v1/wiki/quota', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ used: 5, limit: 100, remaining: 95 }),
      })
    })

    // Mock the wiki ask streaming response
    await mockWikiAskStream(page, '机器学习是人工智能的核心分支，它通过数据驱动的方式让计算机自动学习和改进。')

    // Navigate to knowledge page
    await page.goto('/knowledge')
    await page.waitForLoadState('networkidle')

    // Look for the Q&A input area
    const qaInput = page.locator(
      'textarea[placeholder*="问"], input[placeholder*="问"], textarea[placeholder*="搜索"], input[placeholder*="搜索"]'
    ).first()

    // Assert QA input is visible — fail explicitly if the page doesn't render it
    await expect(qaInput).toBeVisible({ timeout: 5000 })

    await qaInput.fill('什么是机器学习？')
    await qaInput.press('Enter')

    // Wait for the streamed response to appear
    await expect(
      page.getByText('机器学习是人工智能的核心分支').first()
    ).toBeVisible({ timeout: 15000 })
  })
})
