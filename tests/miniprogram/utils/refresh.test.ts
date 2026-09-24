import { describe, expect, it } from 'vitest'
import { consumeDirty, markDirty } from '../../../miniprogram/utils/refresh'

describe('refresh 标记', () => {
  it('标记后第一次读取为真，读取后自动清除', () => {
    markDirty('forum')

    expect(consumeDirty('forum')).toBe(true)
    expect(consumeDirty('forum')).toBe(false)
  })

  it('可以一次标记多个列表，互不影响', () => {
    markDirty('forum', 'my-posts')

    expect(consumeDirty('my-posts')).toBe(true)
    expect(consumeDirty('forum')).toBe(true)
  })

  it('没有标记过的列表读取为假', () => {
    expect(consumeDirty('my-posts')).toBe(false)
  })
})
