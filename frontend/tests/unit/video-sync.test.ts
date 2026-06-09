import { describe, it, expect } from 'vitest'

/**
 * Since binarySearchSegment is not exported from use-video-sync.ts,
 * we replicate the exact same logic here for unit testing.
 * This ensures the algorithm correctness independent of React/Jotai.
 */

interface Segment {
  start: number
  end: number
  text: string
}

function binarySearchSegment(segments: Segment[], time: number): number {
  let low = 0
  let high = segments.length - 1
  let result = -1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (segments[mid].start <= time) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  // Verify the matched segment actually covers the current time
  if (result >= 0 && segments[result].end < time) {
    return -1
  }

  return result
}

// Helper to generate segments for performance tests
function generateSegments(count: number, gapMs = 0): Segment[] {
  const segments: Segment[] = []
  let cursor = 0
  for (let i = 0; i < count; i++) {
    const duration = 2 + Math.random() * 8 // 2-10 seconds each
    segments.push({
      start: cursor,
      end: cursor + duration,
      text: `Segment ${i}`,
    })
    cursor += duration + gapMs / 1000
  }
  return segments
}

describe('binarySearchSegment', () => {
  const segments: Segment[] = [
    { start: 0, end: 5, text: 'First' },
    { start: 5, end: 10, text: 'Second' },
    { start: 10, end: 15, text: 'Third' },
    { start: 15, end: 20, text: 'Fourth' },
    { start: 20, end: 25, text: 'Fifth' },
  ]

  describe('exact start time matching', () => {
    it('returns index 0 for time exactly at first segment start', () => {
      expect(binarySearchSegment(segments, 0)).toBe(0)
    })

    it('returns correct index for exact start of middle segment', () => {
      expect(binarySearchSegment(segments, 10)).toBe(2)
    })

    it('returns correct index for exact start of last segment', () => {
      expect(binarySearchSegment(segments, 20)).toBe(4)
    })
  })

  describe('mid-segment time matching', () => {
    it('finds segment when time is in the middle', () => {
      expect(binarySearchSegment(segments, 2.5)).toBe(0)
    })

    it('finds segment for time near end of segment', () => {
      expect(binarySearchSegment(segments, 4.9)).toBe(0)
    })

    it('finds correct segment for time in third segment', () => {
      expect(binarySearchSegment(segments, 12)).toBe(2)
    })

    it('finds last segment for time near its end', () => {
      expect(binarySearchSegment(segments, 24.5)).toBe(4)
    })
  })

  describe('boundary at segment transitions', () => {
    it('time at boundary belongs to the next segment (start <= time)', () => {
      // At time=5, segment[1].start=5 so it matches segment 1
      expect(binarySearchSegment(segments, 5)).toBe(1)
    })

    it('time at exact end of last segment', () => {
      expect(binarySearchSegment(segments, 25)).toBe(4)
    })
  })

  describe('edge cases', () => {
    it('returns -1 for empty segments array', () => {
      expect(binarySearchSegment([], 5)).toBe(-1)
    })

    it('returns -1 for negative time', () => {
      // Negative time: no segment starts at or before negative time
      expect(binarySearchSegment(segments, -1)).toBe(-1)
    })

    it('returns -1 for time beyond last segment end', () => {
      expect(binarySearchSegment(segments, 30)).toBe(-1)
    })

    it('returns -1 for time in a gap between segments', () => {
      const gappedSegments: Segment[] = [
        { start: 0, end: 5, text: 'A' },
        { start: 8, end: 12, text: 'B' }, // gap from 5 to 8
      ]
      // time=6 is after segment A ends but before segment B starts
      expect(binarySearchSegment(gappedSegments, 6)).toBe(-1)
    })

    it('handles single segment', () => {
      const single: Segment[] = [{ start: 0, end: 10, text: 'Only' }]
      expect(binarySearchSegment(single, 0)).toBe(0)
      expect(binarySearchSegment(single, 5)).toBe(0)
      expect(binarySearchSegment(single, 10)).toBe(0)
      expect(binarySearchSegment(single, 11)).toBe(-1)
    })

    it('handles time at exactly 0 with non-zero first segment start', () => {
      const delayed: Segment[] = [
        { start: 2, end: 5, text: 'Delayed start' },
      ]
      // time=0 is before any segment starts
      expect(binarySearchSegment(delayed, 0)).toBe(-1)
    })
  })

  describe('performance', () => {
    it('handles 500+ segments in under 5ms', () => {
      const largeSegments = generateSegments(600)
      const lastSegment = largeSegments[largeSegments.length - 1]
      const testTimes = [
        0,
        lastSegment.end / 4,
        lastSegment.end / 2,
        (lastSegment.end * 3) / 4,
        lastSegment.end - 0.1,
      ]

      const start = performance.now()
      // Run multiple lookups to get a meaningful measurement
      for (let i = 0; i < 10000; i++) {
        for (const time of testTimes) {
          binarySearchSegment(largeSegments, time)
        }
      }
      const elapsed = performance.now() - start

      // 50,000 lookups on 600 segments should complete well under 5ms per lookup
      // Total should be well under 500ms (generous budget)
      expect(elapsed).toBeLessThan(500)
    })

    it('handles 1000 segments correctly', () => {
      const largeSegments = generateSegments(1000)

      // Verify first segment
      expect(binarySearchSegment(largeSegments, 0)).toBe(0)

      // Verify a mid-point segment
      const midIdx = 500
      const midTime = largeSegments[midIdx].start + 0.5
      expect(binarySearchSegment(largeSegments, midTime)).toBe(midIdx)

      // Verify beyond end returns -1
      const beyondEnd = largeSegments[999].end + 10
      expect(binarySearchSegment(largeSegments, beyondEnd)).toBe(-1)
    })
  })
})
