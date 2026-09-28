import type { ActivityDetail, ActivityQuery, ActivitySummary } from '../../types/activities'
import type { Paginated } from '../../types/api'
import { request } from '../request'

export function listActivities(query: ActivityQuery = {}): Promise<Paginated<ActivitySummary>> {
  return request<Paginated<ActivitySummary>>({
    method: 'GET',
    path: '/activities',
    query: { category: query.category, q: query.q, cursor: query.cursor },
    auth: false,
  })
}

export function getActivity(id: number): Promise<ActivityDetail> {
  return request<ActivityDetail>({ method: 'GET', path: `/activities/${id}`, auth: false })
}
