import type { HomeData } from '../../../types/api'
import { getDb } from '../db'
import type { MockRoute } from '../router'
import { toMerchantSummary } from '../views'

function getHome(): HomeData {
  const db = getDb()
  return {
    banners: db.banners.map((banner) => ({ ...banner })),
    featured_merchants: db.merchants
      .filter((merchant) => merchant.is_active && merchant.is_featured)
      .map((merchant) => toMerchantSummary(db, merchant)),
  }
}

export const homeRoutes: MockRoute[] = [{ method: 'GET', pattern: '/home', handler: getHome }]
