import { test as base, type Page, type BrowserContext } from '@playwright/test'

/**
 * Local-owner fixture for single-user community mode.
 *
 * Usage:
 *   import { test } from './fixtures/auth.fixture'
 *   test('my test', async ({ authedPage }) => { ... })
 */

// Mock user data matching the CurrentUser interface from lib/api.ts
export const MOCK_USER = {
  id: 'test-user-001',
  nickname: '测试用户',
  avatar_url: null,
  email: 'test@example.com',
  phone: null,
  is_admin: true,
}

type AuthFixtures = {
  authedPage: Page
  authedContext: BrowserContext
}

export const test = base.extend<AuthFixtures>({
  authedContext: async ({ browser }, use) => {
    const context = await browser.newContext()
    await use(context)
    await context.close()
  },

  authedPage: async ({ authedContext }, use) => {
    const page = await authedContext.newPage()

    // Mock the /api/v1/auth/me endpoint to return our test user
    await page.route('**/api/v1/auth/me', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      })
    })

    await use(page)
  },
})

export { expect } from '@playwright/test'
