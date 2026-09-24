import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../../../miniprogram/services/mock/db'
import type {
  HomeData,
  MerchantDetail,
  MerchantFilters,
  MerchantSummary,
  Paginated,
} from '../../../../miniprogram/types/api'
import { call, errorCodeOf } from './call'

function list(query: Record<string, string | number | undefined> = {}): Paginated<MerchantSummary> {
  return call<Paginated<MerchantSummary>>('GET', '/merchants', undefined, query)
}

beforeEach(() => {
  resetDb()
})

describe('首页', () => {
  it('返回轮播图和精选商家', () => {
    const home = call<HomeData>('GET', '/home')

    expect(home.banners).toHaveLength(3)
    expect(home.featured_merchants).toHaveLength(3)
  })
})

describe('商家筛选项', () => {
  it('返回分类和区域', () => {
    const filters = call<MerchantFilters>('GET', '/merchants/filters')

    expect(filters.categories.map((item) => item.name)).toEqual([
      '餐饮',
      '奶茶甜品',
      '购物',
      '生活服务',
    ])
    expect(filters.areas.map((item) => item.name)).toEqual(['Clayton', 'Caulfield', 'City'])
  })
})

describe('商家列表', () => {
  it('每页 6 条，用游标翻页', () => {
    const first = list()
    const second = list({ cursor: first.next_cursor ?? undefined })

    expect(first.items).toHaveLength(6)
    expect(first.next_cursor).toBe('6')
    expect(second.items).toHaveLength(2)
    expect(second.next_cursor).toBeNull()
  })

  it('按分类筛选', () => {
    const result = list({ category: 2 })

    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item) => item.category.id === 2)).toBe(true)
  })

  it('按区域筛选', () => {
    const result = list({ area: 3 })

    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item) => item.area.name === 'City')).toBe(true)
  })

  it('按名称搜索，不区分大小写', () => {
    expect(list({ q: '蜀香' }).items.map((item) => item.name)).toEqual(['蜀香小馆'])
    expect(list({ q: 'kiwi' }).items.map((item) => item.name)).toEqual(['Kiwi 手机维修'])
  })

  it('没有匹配时返回空列表', () => {
    expect(list({ q: '不存在的商家' })).toEqual({ items: [], next_cursor: null })
  })
})

describe('商家详情', () => {
  it('返回完整信息', () => {
    const detail = call<MerchantDetail>('GET', '/merchants/1')

    expect(detail.name).toBe('蜀香小馆')
    expect(detail.image_urls.length).toBeGreaterThan(0)
    expect(detail.phone).not.toBe('')
  })

  it('不存在的商家返回 NOT_FOUND', () => {
    expect(errorCodeOf(() => call('GET', '/merchants/999'))).toBe('NOT_FOUND')
  })
})
