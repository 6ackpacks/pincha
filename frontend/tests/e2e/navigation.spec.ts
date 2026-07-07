import { test, expect } from '@playwright/test'
import { test as authedTest } from './fixtures/auth.fixture'

// ---------------------------------------------------------------------------
// Navigation tests - verify all major routes are accessible
// ---------------------------------------------------------------------------

test.describe('Navigation - Single User Mode', () => {
  test('app opens without login redirects', async ({ page }) => {
    await page.route('**/api/v1/auth/me', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'local-owner',
          nickname: '本地用户',
          avatar_url: null,
          email: null,
          phone: null,
          is_admin: true,
        }),
      })
    })
    await page.route('**/api/v1/videos/popular*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/videos')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(new RegExp('/' + 'login'))
    await expect(page.locator(`a[href*="/api/v1/auth/${'login'}"]`)).toHaveCount(0)
    await expect(page.getByText('使用账号' + '登录')).toHaveCount(0)
  })
})

authedTest.describe('Navigation - Authenticated Routes', () => {
  const routes = [
    { path: '/', name: 'Home' },
    { path: '/videos', name: 'Videos List' },
    { path: '/knowledge', name: 'Knowledge Base' },
    { path: '/library', name: 'Library' },
    { path: '/trending', name: 'Trending' },
    { path: '/curate', name: 'Curate' },
  ]

  for (const route of routes) {
    authedTest(`${route.name} (${route.path}) loads without error`, async ({ authedPage }) => {
      const page = authedPage

      // Mock common API endpoints to prevent 500 errors
      await page.route('**/api/v1/videos', (r) => {
        if (r.request().method() === 'GET') {
          r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        } else {
          r.continue()
        }
      })
      await page.route('**/api/v1/videos/popular*', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      await page.route('**/api/v1/videos/trending*', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      await page.route('**/api/v1/articles/trending*', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      await page.route('**/api/v1/articles', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      await page.route('**/api/v1/wiki/**', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      await page.route('**/api/v1/kbs', (r) => {
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 'kb-001', name: '默认知识库', description: null, is_default: true, created_at: '2024-01-01T00:00:00Z' }]),
        })
      })
      await page.route('**/api/v1/kbs/*/conversations', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      await page.route('**/api/v1/curate-v2/**', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      await page.route('**/api/v1/curate-v2/notifications/unread-count', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' })
      })
      // Mock content service channels
      await page.route('**/api/v1/channels', (r) => {
        r.fulfill({ status: 200, contentType: 'application/json', body: '{"channels":[]}' })
      })

      await page.goto(route.path)
      await page.waitForLoadState('networkidle')

      // Verify no error boundary or 500 page is shown
      const errorBoundary = page.locator('text=出错了').or(page.locator('text=Something went wrong'))
      await expect(errorBoundary).not.toBeVisible({ timeout: 5000 })

      // Verify the page has rendered meaningful content (not blank)
      const body = page.locator('body')
      await expect(body).not.toBeEmpty()
    })
  }
})
