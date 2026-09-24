import type {
  MerchantDetail,
  MerchantFilters,
  MerchantQuery,
  MerchantSummary,
  Paginated,
} from '../../types/api'
import { request } from '../request'

export function getMerchantFilters(): Promise<MerchantFilters> {
  return request<MerchantFilters>({ method: 'GET', path: '/merchants/filters' })
}

export function listMerchants(query: MerchantQuery): Promise<Paginated<MerchantSummary>> {
  return request<Paginated<MerchantSummary>>({
    method: 'GET',
    path: '/merchants',
    query: { category: query.category, area: query.area, q: query.q, cursor: query.cursor },
  })
}

export function getMerchant(id: number): Promise<MerchantDetail> {
  return request<MerchantDetail>({ method: 'GET', path: `/merchants/${id}` })
}
