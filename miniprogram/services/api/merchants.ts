import type { MerchantDetail, MerchantFilters, Paginated } from '../../types/api'
import type {
  LocatedMerchantSummary,
  MerchantMapPin,
  MerchantMapQuery,
  NearbyMerchantQuery,
} from '../../types/merchant-location'
import { request } from '../request'

export function getMerchantFilters(): Promise<MerchantFilters> {
  return request<MerchantFilters>({ method: 'GET', path: '/merchants/filters', auth: false })
}

export function listMerchants(
  query: NearbyMerchantQuery,
): Promise<Paginated<LocatedMerchantSummary>> {
  return request<Paginated<LocatedMerchantSummary>>({
    method: 'GET',
    path: '/merchants',
    auth: false,
    query: {
      category: query.category,
      area: query.area,
      q: query.q,
      cursor: query.cursor,
      latitude: query.latitude,
      longitude: query.longitude,
      sort: query.sort,
    },
  })
}

export function listMerchantMapPins(query: MerchantMapQuery): Promise<{ items: MerchantMapPin[] }> {
  return request<{ items: MerchantMapPin[] }>({
    method: 'GET',
    path: '/merchants/map',
    auth: false,
    query: { category: query.category, area: query.area, q: query.q },
  })
}

export function getMerchant(id: number): Promise<MerchantDetail> {
  return request<MerchantDetail>({ method: 'GET', path: `/merchants/${id}`, auth: false })
}
