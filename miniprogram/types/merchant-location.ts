import type { MerchantQuery, MerchantSummary } from './api'

export interface Coordinates {
  latitude: number
  longitude: number
}

export interface LocatedMerchantSummary extends MerchantSummary, Coordinates {
  // 直线距离（米），未提供用户位置时为 null；不是步行或驾车距离。
  distance_m: number | null
}

export interface NearbyMerchantQuery extends MerchantQuery {
  latitude?: number
  longitude?: number
  sort?: 'distance'
}
