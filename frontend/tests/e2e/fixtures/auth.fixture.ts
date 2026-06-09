import { test as base, type Page, type BrowserContext } from '@playwright/test'

/**
 * Auth fixture that injects a mock session cookie into the browser context.
 *
 * The backend uses cookie-based JWT auth (HttpOnly cookie set after OAuth login
 * via /api/v1/auth/login). In E2E tests we bypass the OAuth flow by injecting
 * the session cookie directly.
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
}

// The session cookie name used by the backend
const SESSION_COOKIE_NAME = 'session'

// A fake JWT token for testing (the backend won't validate it when mocked)
const MOCK_SESSION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMDAxIiwiZXhwIjo5OTk5OTk5OTk5fQ.mock-signature'

type AuthFixtures = {
  authedPage: Page
  authedContext: BrowserContext
}

export const test = base.extend<AuthFixtures>({
  authedContext: async ({ browser }, use) => {
    const context = await browser.newContext()

    // Inject session cookie
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: MOCK_SESSION_TOKEN,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ])

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
