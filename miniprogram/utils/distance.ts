import type { Coordinates } from '../types/merchant-location'

const EARTH_RADIUS_METRES = 6_371_000

export function isValidCoordinates(point: Coordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  )
}

// Haversine 大圆距离只用于附近排序，不能作为路线距离或交通时间。
export function straightLineDistance(from: Coordinates, to: Coordinates): number {
  if (!isValidCoordinates(from) || !isValidCoordinates(to)) {
    throw new RangeError('经纬度超出有效范围')
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDifference = radians(to.latitude - from.latitude)
  const longitudeDifference = radians(to.longitude - from.longitude)
  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeDifference / 2) ** 2
  // 钳制浮点误差，保证对跖点附近也能返回有限距离。
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))))
}

export function formatStraightLineDistance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres) || metres < 0) return ''
  return metres < 1000 ? `直线 ${Math.round(metres)} m` : `直线 ${(metres / 1000).toFixed(1)} km`
}
