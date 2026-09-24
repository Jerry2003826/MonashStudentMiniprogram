import type { HomeData } from '../../types/api'
import { request } from '../request'

export function getHome(): Promise<HomeData> {
  return request<HomeData>({ method: 'GET', path: '/home' })
}
