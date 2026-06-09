import { test, expect } from '@playwright/test'
import { test as authedTest } from './fixtures/auth.fixture'

// ---------------------------------------------------------------------------
// Navigation tests - verify all major routes are accessible
// ---------------------------------------------------------------------------

test.describe('Navigation - Unauthenticated', () => {
  test('unauthenticated user is redirected to login', async ({ page }) => {
    // Mock /api/v1/auth/me to return 401 (unauthenticated)
    await page.route('**/api/v1/auth/me', (route) => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not authenticated' }),
      })
    })

    // Mock popular videos to avoid unrelated errors
    await page.route('**/api/v1/videos/popular*', (route) => {
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' })
    })

    // Try to access a protected route
    await page.goto('/videos')
    await page.waitForLoadState('networkidle')

    // Should be redirected to login page or show login UI
    // The app may redirect to /login or show the login page content
    await expect(
      page.getByText('使用观猹账号登录')
        .or(page.locator('a[href*="/api/v1/auth/login"]'))
        .or(page.locator('text=登录'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // Verify login page elements
    await expect(page.getByText('品猹')).toBeVisible()
    await expect(page.getByText('AI 时代内容学习加速器')).toBeVisible()
    await expect(page.getByText('使用观猹账号登录')).toBeVisible()
    await expect(page.getByText('登录即代表你同意我们的服务条款')).toBeVisible()

    // Verify the login link points to the OAuth endpoint
    const loginLink = page.locator('a[href*="/api/v1/auth/login"]')
    await expect(loginLink).toBeVisible()
  })

  test('login page shows error message from query params', async ({ page }) => {
    await page.goto('/login?error=%E8%AE%A4%E8%AF%81%E5%A4%B1%E8%B4%A5')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('认证失败')).toBeVisible()
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
