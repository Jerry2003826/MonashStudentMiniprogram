import { describe, expect, it } from 'vitest'
import { formatClock, formatDate, formatRelativeTime } from '../../../miniprogram/utils/format'

describe('formatDate', () => {
  it('格式化成 YYYY-MM-DD', () => {
    expect(formatDate('2027-09-24T12:00:00+10:00')).toBe('2027-09-24')
  })
})

describe('formatClock', () => {
  it('格式化成 HH:mm:ss，不足两位补零', () => {
    expect(formatClock(new Date(2026, 8, 24, 9, 5, 3))).toBe('09:05:03')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date(2026, 8, 24, 12, 0, 0)
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE

  it('不到 1 分钟显示「刚刚」', () => {
    expect(formatRelativeTime(ago(30 * 1000), now)).toBe('刚刚')
  })

  it('时间在未来时也显示「刚刚」', () => {
    expect(formatRelativeTime(ago(-5 * MINUTE), now)).toBe('刚刚')
  })

  it('不到 1 小时显示分钟', () => {
    expect(formatRelativeTime(ago(5 * MINUTE), now)).toBe('5 分钟前')
  })

  it('不到 24 小时显示小时', () => {
    expect(formatRelativeTime(ago(3 * HOUR), now)).toBe('3 小时前')
  })

  it('24 到 48 小时显示「昨天」', () => {
    expect(formatRelativeTime(ago(30 * HOUR), now)).toBe('昨天')
  })

  it('同一年更早的时间显示月日', () => {
    expect(formatRelativeTime(new Date(2026, 5, 3, 12).toISOString(), now)).toBe('6月3日')
  })

  it('跨年的时间显示完整日期', () => {
    expect(formatRelativeTime(new Date(2025, 11, 30, 12).toISOString(), now)).toBe('2025-12-30')
  })
})
