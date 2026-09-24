import type {
  MerchantDetail,
  MerchantFilters,
  MerchantSummary,
  Paginated,
} from '../../../types/api'
import { getDb } from '../db'
import { includesText, mockError, paginate, paramNumber, queryNumber } from '../helpers'
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

function listMerchants({ query }: MockRequest): Paginated<MerchantSummary> {
  const db = getDb()
  const category = queryNumber(query, 'category')
  const area = queryNumber(query, 'area')
  const keyword = query.q ?? ''
  const matched = db.merchants.filter(
    (merchant) =>
      merchant.is_active &&
      (category === undefined || merchant.category_id === category) &&
      (area === undefined || merchant.area_id === area) &&
      includesText(merchant.name, keyword),
  )
  const page = paginate(matched, query.cursor, PAGE_SIZE)
  return { ...page, items: page.items.map((merchant) => toMerchantSummary(db, merchant)) }
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
  { method: 'GET', pattern: '/merchants/:id', handler: getMerchant },
]
