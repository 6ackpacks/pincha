import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { createTestProvider } from '../mocks/jotai-provider'
import { MockPlayer } from '../mocks/xgplayer'

// Mock xgplayer module before importing the component
vi.mock('xgplayer', () => ({
  default: MockPlayer,
}))

// Track created player instances
let createdPlayers: MockPlayer[] = []
const OriginalMockPlayer = MockPlayer

vi.mock('xgplayer', () => {
  return {
    default: class TrackedPlayer extends OriginalMockPlayer {
      constructor(config: Record<string, unknown>) {
        super(config)
        createdPlayers.push(this)
      }
    },
  }
})

describe('VideoPlayer', () => {
  beforeEach(() => {
    createdPlayers = []
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a container div for direct video URLs', async () => {
    const { VideoPlayer } = await import(
      '@/components/video/video-player'
    )
    const { TestProvider } = createTestProvider()

    const { container } = render(
      <TestProvider>
        <VideoPlayer url="https://example.com/video.mp4" />
      </TestProvider>
    )

    // Should render the xgplayer container div
    const playerDiv = container.querySelector('.aspect-video')
    expect(playerDiv).toBeInTheDocument()
  })

  it('renders YouTube embed for youtube platform URLs', async () => {
    const { VideoPlayer } = await import(
      '@/components/video/video-player'
    )
    const { TestProvider } = createTestProvider()

    const { container } = render(
      <TestProvider>
        <VideoPlayer
          url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
          platform="youtube"
          title="Test Video"
        />
      </TestProvider>
    )

    // Should render the YT host div (API-based player)
    const ytHost = container.querySelector('.aspect-video')
    expect(ytHost).toBeInTheDocument()
  })

  it('renders fallback view for unknown platform URLs', async () => {
    const { VideoPlayer } = await import(
      '@/components/video/video-player'
    )
    const { TestProvider } = createTestProvider()

    const { container } = render(
      <TestProvider>
        <VideoPlayer
          url="https://www.bilibili.com/video/BV1xx411c7mD"
          platform="bilibili"
        />
      </TestProvider>
    )

    // Should render the fallback with "在原平台观看" link
    const link = container.querySelector('a[href*="bilibili"]')
    expect(link).toBeInTheDocument()
    expect(link?.textContent).toContain('在原平台观看')
  })

  it('passes URL to xgplayer for direct video URLs', async () => {
    const { VideoPlayer } = await import(
      '@/components/video/video-player'
    )
    const { TestProvider } = createTestProvider()

    render(
      <TestProvider>
        <VideoPlayer url="https://cdn.example.com/stream.m3u8" />
      </TestProvider>
    )

    // Wait for dynamic import to resolve
    await vi.waitFor(() => {
      expect(createdPlayers.length).toBeGreaterThan(0)
    })

    expect(createdPlayers[0].url).toBe('https://cdn.example.com/stream.m3u8')
  })

  it('calls destroy on unmount for direct video URLs', async () => {
    const { VideoPlayer } = await import(
      '@/components/video/video-player'
    )
    const { TestProvider } = createTestProvider()

    const { unmount } = render(
      <TestProvider>
        <VideoPlayer url="https://cdn.example.com/video.mp4" />
      </TestProvider>
    )

    // Wait for player to be created
    await vi.waitFor(() => {
      expect(createdPlayers.length).toBeGreaterThan(0)
    })

    const player = createdPlayers[0]
    unmount()

    expect(player.destroy).toHaveBeenCalled()
  })

  it('shows thumbnail in fallback view when provided', async () => {
    const { VideoPlayer } = await import(
      '@/components/video/video-player'
    )
    const { TestProvider } = createTestProvider()

    const { container } = render(
      <TestProvider>
        <VideoPlayer
          url="https://www.bilibili.com/video/BV1xx411c7mD"
          platform="bilibili"
          thumbnailUrl="https://example.com/thumb.jpg"
          title="Test"
        />
      </TestProvider>
    )

    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img?.getAttribute('src')).toBe('https://example.com/thumb.jpg')
  })
})
