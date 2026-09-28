import { describe, expect, it } from 'vitest'
import {
  formatStraightLineDistance,
  isValidCoordinates,
  straightLineDistance,
} from '../../../miniprogram/utils/distance'

describe('商家直线距离', () => {
  it('同一位置返回零，赤道一度约为 111.2 千米', () => {
    const origin = { latitude: 0, longitude: 0 }
    expect(straightLineDistance(origin, origin)).toBe(0)
    expect(straightLineDistance(origin, { latitude: 0, longitude: 1 })).toBeCloseTo(111194.927, 2)
  })

  it('跨越国际日期变更线时使用较短距离', () => {
    const west = { latitude: 0, longitude: 179.9 }
    const east = { latitude: 0, longitude: -179.9 }
    expect(straightLineDistance(west, east)).toBeCloseTo(22238.985, 2)
    expect(straightLineDistance(west, east)).toBe(straightLineDistance(east, west))
  })

  it('对跖点返回有限的半球距离', () => {
    const distance = straightLineDistance(
      { latitude: 90, longitude: 0 },
      { latitude: -90, longitude: 180 },
    )
    expect(Number.isFinite(distance)).toBe(true)
    expect(distance).toBeCloseTo(20015086.796, 2)
  })

  it.each([
    { latitude: 91, longitude: 0 },
    { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: -181 },
    { latitude: NaN, longitude: 0 },
    { latitude: 0, longitude: Infinity },
  ])('拒绝非法坐标 %o', (point) => {
    expect(isValidCoordinates(point)).toBe(false)
    expect(() => straightLineDistance(point, { latitude: 0, longitude: 0 })).toThrow(RangeError)
  })

  it('显示米或千米，并明确距离为直线距离', () => {
    expect(formatStraightLineDistance(0)).toBe('直线 0 m')
    expect(formatStraightLineDistance(120.4)).toBe('直线 120 m')
    expect(formatStraightLineDistance(1750)).toBe('直线 1.8 km')
    expect(formatStraightLineDistance(null)).toBe('')
    expect(formatStraightLineDistance(undefined)).toBe('')
    expect(formatStraightLineDistance(NaN)).toBe('')
    expect(formatStraightLineDistance(-1)).toBe('')
  })
})
