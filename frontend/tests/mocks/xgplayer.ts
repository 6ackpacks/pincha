import { vi } from 'vitest'

/**
 * Mock xgplayer Player class.
 * The real video-player.tsx does: const { default: Player } = await import("xgplayer")
 * so we mock the default export.
 */

type EventHandler = (...args: unknown[]) => void

export class MockPlayer {
  el: HTMLElement | null = null
  url: string = ''
  currentTime: number = 0
  paused: boolean = true

  private handlers: Map<string, EventHandler[]> = new Map()

  destroy = vi.fn()
  play = vi.fn(() => {
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })

  constructor(config: Record<string, unknown>) {
    this.el = config.el as HTMLElement
    this.url = config.url as string
  }

  on(event: string, handler: EventHandler) {
    const list = this.handlers.get(event) || []
    list.push(handler)
    this.handlers.set(event, list)
  }

  off(event: string, handler: EventHandler) {
    const list = this.handlers.get(event) || []
    this.handlers.set(
      event,
      list.filter((h) => h !== handler)
    )
  }

  emit(event: string, ...args: unknown[]) {
    const list = this.handlers.get(event) || []
    list.forEach((h) => h(...args))
  }
}

// Default export matches how xgplayer is imported
export default MockPlayer
