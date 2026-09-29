import type { MerchantDetail, MerchantFilters, Paginated } from '../../../types/api'
import type {
  Coordinates,
  LocatedMerchantSummary,
  MerchantMapPin,
} from '../../../types/merchant-location'
import { isValidCoordinates, straightLineDistance } from '../../../utils/distance'
import { getDb } from '../db'
import { includesText, mockError, paginate, paramNumber } from '../helpers'
import type { MockRequest, MockRoute } from '../router'
import { toMerchantDetail, toMerchantSummary } from '../views'

const PAGE_SIZE = 6

function getFilters(): MerchantFilters {
  const db = getDb()
  return {
    categories: db.categories.map((item) => ({ ...item })),
    areas: db.areas.map((item) => ({ ...item })),
  }
}

function readFilter(query: Record<string, string>, key: string): number | undefined {
  const raw = query[key]
  if (raw === undefined) return undefined
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw mockError('VALIDATION_ERROR', '商家筛选条件无效')
  }
  return Number(raw)
}

function readLocation(query: Record<string, string>): Coordinates | null {
  const hasLatitude = query.latitude !== undefined
  const hasLongitude = query.longitude !== undefined
  if (!hasLatitude && !hasLongitude) {
    if (query.sort === 'distance') throw mockError('VALIDATION_ERROR', '附近排序需要当前位置')
    return null
  }
  const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
  if (
    !hasLatitude ||
    !hasLongitude ||
    !decimal.test(query.latitude.trim()) ||
    !decimal.test(query.longitude.trim())
  ) {
    throw mockError('VALIDATION_ERROR', '请同时提供有效的经纬度')
  }
  const location = { latitude: Number(query.latitude), longitude: Number(query.longitude) }
  if (!isValidCoordinates(location)) throw mockError('VALIDATION_ERROR', '经纬度超出有效范围')
  return location
}

function matchingMerchants(query: Record<string, string>) {
  const category = readFilter(query, 'category')
  const area = readFilter(query, 'area')
  const keyword = query.q ?? ''
  return getDb().merchants.filter(
    (merchant) =>
      merchant.is_active &&
      (category === undefined || merchant.category_id === category) &&
      (area === undefined || merchant.area_id === area) &&
      includesText(merchant.name, keyword),
  )
}

function listMerchants({ query }: MockRequest): Paginated<LocatedMerchantSummary> {
  const db = getDb()
  const matched = matchingMerchants(query)
  if (query.sort !== undefined && query.sort !== 'distance') {
    throw mockError('VALIDATION_ERROR', '不支持的商家排序方式')
  }
  if (
    query.cursor !== undefined &&
    (!/^(0|[1-9]\d*)$/.test(query.cursor) || !Number.isSafeInteger(Number(query.cursor)))
  ) {
    throw mockError('VALIDATION_ERROR', '分页游标无效')
  }
  const location = readLocation(query)
  const items: LocatedMerchantSummary[] = matched.map((merchant) => ({
    ...toMerchantSummary(db, merchant),
    latitude: merchant.latitude,
    longitude: merchant.longitude,
    distance_m: location ? straightLineDistance(location, merchant) : null,
  }))
  if (query.sort === 'distance') {
    items.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0) || a.id - b.id)
  }
  // 对所有符合筛选条件的商家先排序，再分页，避免只在当前页内排序。
  return paginate(items, query.cursor, PAGE_SIZE)
}

// 地图要显示全部匹配的商家，列表分页只加载了一部分，所以这里不分页。
function listMapPins({ query }: MockRequest): { items: MerchantMapPin[] } {
  const unsupported = Object.keys(query).filter((key) => !['category', 'area', 'q'].includes(key))
  if (unsupported.length) throw mockError('VALIDATION_ERROR', '包含不支持的查询参数')
  const db = getDb()
  return {
    items: matchingMerchants(query).map((merchant) => {
      const { id, name, category, discount_summary } = toMerchantSummary(db, merchant)
      return {
        id,
        name,
        category,
        discount_summary,
        latitude: merchant.latitude,
        longitude: merchant.longitude,
      }
    }),
  }
}

function getMerchant({ params }: MockRequest): MerchantDetail {
  const db = getDb()
  const id = paramNumber(params, 'id')
  const merchant = db.merchants.find((item) => item.id === id && item.is_active)
  if (!merchant) throw mockError('NOT_FOUND', '商家不存在或已下架')
  return toMerchantDetail(db, merchant)
}

export const merchantRoutes: MockRoute[] = [
  { method: 'GET', pattern: '/merchants/filters', handler: getFilters },
  { method: 'GET', pattern: '/merchants', handler: listMerchants },
  { method: 'GET', pattern: '/merchants/map', handler: listMapPins },
  { method: 'GET', pattern: '/merchants/:id', handler: getMerchant },
]
