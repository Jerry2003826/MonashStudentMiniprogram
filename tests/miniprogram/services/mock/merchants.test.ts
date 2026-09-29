import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDb } from '../../../../miniprogram/services/mock/db'
import type {
  HomeData,
  MerchantDetail,
  MerchantFilters,
  Paginated,
} from '../../../../miniprogram/types/api'
import type {
  LocatedMerchantSummary,
  MerchantMapPin,
} from '../../../../miniprogram/types/merchant-location'
import { call, errorCodeOf } from './call'

function list(
  query: Record<string, string | number | undefined> = {},
): Paginated<LocatedMerchantSummary> {
  return call<Paginated<LocatedMerchantSummary>>('GET', '/merchants', undefined, query)
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

  it('默认提供商家地图坐标，不伪造用户距离', () => {
    for (const merchant of list().items) {
      expect(Number.isFinite(merchant.latitude)).toBe(true)
      expect(Number.isFinite(merchant.longitude)).toBe(true)
      expect(merchant.distance_m).toBeNull()
    }
  })

  it('先对所有匹配商家按距离排序，再分页，第二页无重复或遗漏', () => {
    const db = getDb()
    db.merchants.forEach((merchant) => {
      merchant.latitude = 0
      merchant.longitude = 8 - merchant.id
    })
    const query = { latitude: 0, longitude: 0, sort: 'distance' }
    const first = list(query)
    const second = list({ ...query, cursor: first.next_cursor ?? undefined })
    expect(first.items.map((merchant) => merchant.id)).toEqual([8, 7, 6, 5, 4, 3])
    expect(second.items.map((merchant) => merchant.id)).toEqual([2, 1])
    expect(second.next_cursor).toBeNull()
    expect(first.items[0].distance_m).toBe(0)
    const distances = [...first.items, ...second.items].map((merchant) => merchant.distance_m)
    expect(distances).toEqual([...distances].sort((a, b) => (a ?? 0) - (b ?? 0)))
  })

  it('等距离时按商家 ID 稳定排序，不依赖存储顺序', () => {
    const db = getDb()
    db.merchants.reverse().forEach((merchant) => {
      merchant.latitude = 0
      merchant.longitude = 0
    })
    expect(
      list({ latitude: 0, longitude: 0, sort: 'distance' }).items.map((item) => item.id),
    ).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('附近排序继续遵守分类、区域、名称和上架条件', () => {
    const db = getDb()
    const merchant = db.merchants[0]
    const query = {
      latitude: merchant.latitude,
      longitude: merchant.longitude,
      sort: 'distance',
      category: merchant.category_id,
      area: merchant.area_id,
      q: merchant.name,
    }
    expect(list(query).items.map((item) => item.id)).toEqual([merchant.id])
    merchant.is_active = false
    expect(list(query).items).toEqual([])
  })

  it.each([
    { latitude: 0 },
    { longitude: 0 },
    { latitude: '', longitude: 0 },
    { latitude: ' ', longitude: 0 },
    { latitude: '0x1', longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: -181 },
    { latitude: NaN, longitude: 0 },
    { latitude: 0, longitude: Infinity },
    { sort: 'distance' },
    { sort: 'walking' },
    { cursor: '-1' },
    { cursor: '1.5' },
    { cursor: 'bad' },
    { cursor: '' },
    { cursor: '9007199254740992' },
    { category: 'all' },
    { area: -1 },
  ])('拒绝无效坐标、排序或分页参数 %o', (query) => {
    expect(errorCodeOf(() => list(query))).toBe('VALIDATION_ERROR')
  })
})

describe('商家地图点位', () => {
  function pins(query: Record<string, string | number | undefined> = {}): MerchantMapPin[] {
    return call<{ items: MerchantMapPin[] }>('GET', '/merchants/map', undefined, query).items
  }

  it('不分页，返回全部上架商家的坐标', () => {
    const active = getDb().merchants.filter((merchant) => merchant.is_active)
    expect(active.length).toBeGreaterThan(6)
    const all = pins()
    expect(all.map((pin) => pin.id)).toEqual(active.map((merchant) => merchant.id))
    expect(Object.keys(all[0]).sort()).toEqual(
      ['category', 'discount_summary', 'id', 'latitude', 'longitude', 'name'].sort(),
    )
  })

  it('和列表使用同样的分类、区域、名称和上架条件', () => {
    const db = getDb()
    const merchant = db.merchants[0]
    const query = { category: merchant.category_id, area: merchant.area_id, q: merchant.name }
    expect(pins(query).map((pin) => pin.id)).toEqual(list(query).items.map((item) => item.id))
    merchant.is_active = false
    expect(pins(query)).toEqual([])
  })

  it.each([{ category: 'all' }, { area: 0 }, { cursor: '0' }, { sort: 'distance' }])(
    '拒绝无效或不支持的参数 %o',
    (query) => {
      expect(errorCodeOf(() => pins(query))).toBe('VALIDATION_ERROR')
    },
  )
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
