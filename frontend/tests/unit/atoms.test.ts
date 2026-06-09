import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import { currentTimeAtom, activeSegmentIndexAtom, seekFnAtom } from '@/atoms/player'

describe('Player Atoms', () => {
  it('currentTimeAtom 初始值为 0', () => {
    const store = createStore()
    expect(store.get(currentTimeAtom)).toBe(0)
  })

  it('activeSegmentIndexAtom 初始值为 -1', () => {
    const store = createStore()
    expect(store.get(activeSegmentIndexAtom)).toBe(-1)
  })

  it('seekFnAtom 初始值为 null', () => {
    const store = createStore()
    expect(store.get(seekFnAtom)).toBeNull()
  })

  it('设置 currentTime 更新 store 中的值', () => {
    const store = createStore()
    store.set(currentTimeAtom, 42.5)
    expect(store.get(currentTimeAtom)).toBe(42.5)
  })

  it('设置 activeSegmentIndexAtom 更新正确', () => {
    const store = createStore()
    store.set(activeSegmentIndexAtom, 3)
    expect(store.get(activeSegmentIndexAtom)).toBe(3)
  })

  it('seekFnAtom 可以存储和调用函数', () => {
    const store = createStore()
    let seekedTo = -1
    const mockSeek = (time: number) => { seekedTo = time }

    store.set(seekFnAtom, () => mockSeek)
    const fn = store.get(seekFnAtom)
    expect(fn).not.toBeNull()
    fn!(10.5)
    expect(seekedTo).toBe(10.5)
  })
})
