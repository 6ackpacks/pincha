import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

describe('API Client', () => {
  let apiModule: typeof import('@/lib/api')

  beforeEach(async () => {
    localStorageMock.clear()
    vi.stubGlobal('fetch', vi.fn())
    // Fresh import to avoid module caching issues
    vi.resetModules()
    apiModule = await import('@/lib/api')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('request function (via getVideos)', () => {
    it('成功请求返回 JSON 数据', async () => {
      const mockData = [{ id: '1', title: 'Test Video' }]
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        json: () => Promise.resolve(mockData),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await apiModule.getVideos()
      expect(result).toEqual(mockData)
    })

    it('非 ok 响应抛出 Error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'Unauthorized' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await expect(apiModule.getVideos()).rejects.toThrow('Unauthorized')
    })

    it('网络错误抛出 Error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      vi.stubGlobal('fetch', mockFetch)

      await expect(apiModule.getVideos()).rejects.toThrow('Failed to fetch')
    })

    it('请求自动带上 credentials: include', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '2' }),
        json: () => Promise.resolve([]),
      })
      vi.stubGlobal('fetch', mockFetch)

      await apiModule.getVideos()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ credentials: 'include' }),
      )
    })

    it('localStorage 中有 KB ID 时自动注入 X-KB-ID header', async () => {
      localStorageMock.setItem('pingcha_active_kb_id', '"kb-123"')
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '2' }),
        json: () => Promise.resolve([]),
      })
      vi.stubGlobal('fetch', mockFetch)

      await apiModule.getVideos()
      const callHeaders = mockFetch.mock.calls[0][1].headers
      expect(callHeaders['X-KB-ID']).toBe('kb-123')
    })
  })

  describe('getVideos', () => {
    it('无参数时调用正确的 URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '2' }),
        json: () => Promise.resolve([]),
      })
      vi.stubGlobal('fetch', mockFetch)

      await apiModule.getVideos()
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/videos',
        expect.any(Object),
      )
    })

    it('带搜索参数时 URL 包含 query', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '2' }),
        json: () => Promise.resolve([]),
      })
      vi.stubGlobal('fetch', mockFetch)

      await apiModule.getVideos('AI')
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/videos?q=AI',
        expect.any(Object),
      )
    })
  })

  describe('submitVideo', () => {
    it('POST 请求带正确 body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        json: () => Promise.resolve({ id: 'new-id', url: 'https://youtube.com/watch?v=x' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await apiModule.submitVideo('https://youtube.com/watch?v=x', 'youtube')
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/videos',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', platform: 'youtube' }),
        }),
      )
    })
  })
})
