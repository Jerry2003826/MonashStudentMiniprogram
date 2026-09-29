import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MerchantMapPin } from '../../../miniprogram/types/merchant-location'

const mocks = vi.hoisted(() => ({
  filters: vi.fn(),
  list: vi.fn(),
  pins: vi.fn(),
  showError: vi.fn(),
}))

vi.mock('../../../miniprogram/services/api/merchants', () => ({
  getMerchantFilters: mocks.filters,
  listMerchants: mocks.list,
  listMerchantMapPins: mocks.pins,
}))
vi.mock('../../../miniprogram/services/auth', () => ({
  fetchMe: vi.fn(() => Promise.reject(new Error('未登录'))),
  getCachedMe: vi.fn(() => null),
}))
vi.mock('../../../miniprogram/services/errors', () => ({ showError: mocks.showError }))
vi.mock('../../../miniprogram/utils/tab-bar', () => ({ syncTabBar: vi.fn() }))

interface MerchantsPage {
  data: {
    category: number
    mapVisible: boolean
    pins: MerchantMapPin[]
    pinsFailed: boolean
    markers: { id: number }[]
    selectedPin: (MerchantMapPin & { distanceText: string }) | null
    location: { latitude: number; longitude: number } | null
    mapCentre: { latitude: number; longitude: number }
  }
  setData(patch: Record<string, unknown>, callback?: () => void): void
  onLoad(): Promise<void>
  loadPins(): Promise<void>
  onToggleMap(): void
  onCategoryChange(e: { detail: { value: number } }): void
  onMarkerTap(e: { detail: { markerId: number } }): void
  onOpenSelectedPin(): void
}

function pin(id: number, longitude = 145): MerchantMapPin {
  return {
    id,
    name: `商家 ${id}`,
    category: { id: 1, name: '餐饮' },
    discount_summary: '九折',
    latitude: -37.9,
    longitude,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

const navigateTo = vi.fn()
const includePoints = vi.fn()

async function createPage(): Promise<MerchantsPage> {
  const register = vi.fn()
  vi.stubGlobal('Page', register)
  vi.stubGlobal('wx', {
    navigateTo,
    showToast: vi.fn(),
    createMapContext: vi.fn(() => ({ includePoints })),
  })
  vi.resetModules()
  await import('../../../miniprogram/pages/merchants/index')
  const definition = register.mock.calls[0][0] as MerchantsPage
  const page: MerchantsPage = {
    ...definition,
    data: { ...definition.data },
    setData(patch, callback) {
      Object.assign(this.data, patch)
      callback?.()
    },
  }
  await page.onLoad()
  return page
}

beforeEach(() => {
  mocks.filters.mockResolvedValue({ categories: [{ id: 1, name: '餐饮' }], areas: [] })
  mocks.list.mockResolvedValue({ items: [], next_cursor: null })
  mocks.pins.mockResolvedValue({ items: [pin(1), pin(2), pin(3)] })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('商家地图', () => {
  it('展开地图时才加载点位，显示全部匹配商家而不只是列表第一页', async () => {
    const page = await createPage()
    expect(mocks.pins).not.toHaveBeenCalled()

    page.onToggleMap()
    await vi.waitFor(() => expect(page.data.markers).toHaveLength(3))
    expect(mocks.pins).toHaveBeenCalledWith({ q: undefined, category: undefined, area: undefined })

    // 收起再展开，筛选条件没变就不重复请求
    page.onToggleMap()
    page.onToggleMap()
    expect(mocks.pins).toHaveBeenCalledOnce()
  })

  it('地图展开时切换分类会用新条件重新加载点位', async () => {
    const page = await createPage()
    page.onToggleMap()
    await vi.waitFor(() => expect(page.data.markers).toHaveLength(3))

    mocks.pins.mockResolvedValue({ items: [pin(2)] })
    page.onCategoryChange({ detail: { value: 1 } })
    await vi.waitFor(() => expect(page.data.markers.map((marker) => marker.id)).toEqual([2]))
    expect(mocks.pins).toHaveBeenLastCalledWith({ q: undefined, category: 1, area: undefined })
  })

  it('地图收起时切换筛选不请求点位，展开时再加载', async () => {
    const page = await createPage()
    page.onCategoryChange({ detail: { value: 1 } })
    expect(mocks.pins).not.toHaveBeenCalled()

    page.onToggleMap()
    await vi.waitFor(() =>
      expect(mocks.pins).toHaveBeenCalledWith(expect.objectContaining({ category: 1 })),
    )
  })

  it('筛选切换太快时，只保留最后一次点位请求的结果', async () => {
    const page = await createPage()
    const slow = deferred<{ items: MerchantMapPin[] }>()
    mocks.pins.mockReturnValueOnce(slow.promise)
    page.onToggleMap()

    mocks.pins.mockResolvedValueOnce({ items: [pin(9)] })
    page.onCategoryChange({ detail: { value: 1 } })
    await vi.waitFor(() => expect(page.data.markers.map((marker) => marker.id)).toEqual([9]))

    slow.resolve({ items: [pin(1), pin(2)] })
    await slow.promise
    await Promise.resolve()
    expect(page.data.markers.map((marker) => marker.id)).toEqual([9])
  })

  it('点标记先显示商家卡片，点卡片再进入详情；收起地图时关闭卡片', async () => {
    const page = await createPage()
    page.onToggleMap()
    await vi.waitFor(() => expect(page.data.markers).toHaveLength(3))

    page.onMarkerTap({ detail: { markerId: 2 } })
    expect(navigateTo).not.toHaveBeenCalled()
    expect(page.data.selectedPin).toMatchObject({ id: 2, name: '商家 2', distanceText: '' })

    page.onOpenSelectedPin()
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/merchant-detail/index?id=2' })

    page.onToggleMap()
    expect(page.data.selectedPin).toBeNull()
  })

  it('开启附近排序后，卡片显示直线距离', async () => {
    const page = await createPage()
    page.setData({ location: { latitude: -37.9, longitude: 145 } })
    page.onToggleMap()
    await vi.waitFor(() => expect(page.data.markers).toHaveLength(3))

    page.onMarkerTap({ detail: { markerId: 1 } })
    expect(page.data.selectedPin?.distanceText).toBe('直线 0 m')
  })

  it('地图居中到所有商家的中间，并缩放到包住全部标记；每次展开都重新缩放', async () => {
    mocks.pins.mockResolvedValue({ items: [pin(1, 145), pin(2, 145.2), pin(3, 145.1)] })
    const page = await createPage()
    page.onToggleMap()
    await vi.waitFor(() => expect(includePoints).toHaveBeenCalledOnce())
    expect(page.data.mapCentre).toEqual({ latitude: -37.9, longitude: 145.1 })
    expect(includePoints.mock.calls[0][0].points).toHaveLength(3)

    page.onToggleMap()
    page.onToggleMap()
    expect(includePoints).toHaveBeenCalledTimes(2)
  })

  it('点位加载失败时提示错误并可重试', async () => {
    mocks.pins.mockRejectedValueOnce(new Error('网络错误'))
    const page = await createPage()
    page.onToggleMap()
    await vi.waitFor(() => expect(page.data.pinsFailed).toBe(true))
    expect(mocks.showError).toHaveBeenCalled()

    await page.loadPins()
    expect(page.data.pinsFailed).toBe(false)
    expect(page.data.markers).toHaveLength(3)
  })
})
