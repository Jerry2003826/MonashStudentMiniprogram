import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivitySummary } from '../../../miniprogram/types/activities'
import type { HomeData, MerchantSummary } from '../../../miniprogram/types/api'
import { memberEntry } from '../../../miniprogram/utils/membership'

const mocks = vi.hoisted(() => ({ home: vi.fn(), activities: vi.fn(), me: vi.fn() }))
vi.mock('../../../miniprogram/services/api/home', () => ({ getHome: mocks.home }))
vi.mock('../../../miniprogram/services/api/activities', () => ({
  listActivities: mocks.activities,
}))
vi.mock('../../../miniprogram/services/auth', () => ({ fetchMe: mocks.me }))

interface State {
  activities: ActivitySummary[]
  featured: MerchantSummary[]
  entry: ReturnType<typeof memberEntry>
  homeError: boolean
  activitiesError: boolean
  loading: boolean
  activitiesLoading: boolean
}

interface TestPage {
  data: State
  requestSeq: number
  setData(patch: Partial<State>): void
  load(): Promise<void>
}

function activity(id: number): ActivitySummary {
  return {
    id,
    title: `活动${id}`,
    summary: '示例',
    category: 'latest',
    starts_at: null,
    location: '待公布',
    is_example: true,
  }
}

let page: TestPage

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.home.mockResolvedValue({ banners: [], featured_merchants: [] })
  mocks.activities.mockResolvedValue({ items: [activity(1)], next_cursor: null })
  mocks.me.mockRejectedValue(new Error('微信登录暂时不可用'))
  const register = vi.fn()
  vi.stubGlobal('Page', register)
  await import('../../../miniprogram/pages/home/index')
  const definition = register.mock.calls[0][0] as TestPage
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('首页各模块独立加载', () => {
  it('微信登录失败仍展示公开活动，首页最多显示三个', async () => {
    mocks.activities.mockResolvedValue({ items: [1, 2, 3, 4].map(activity), next_cursor: null })
    await page.load()
    expect(page.data.activities.map((item) => item.id)).toEqual([1, 2, 3])
    expect(page.data.homeError).toBe(false)
    expect(page.data.activitiesError).toBe(false)
    expect(page.data.entry).toEqual(memberEntry(null))
    expect(page.data.loading).toBe(false)
    expect(page.data.activitiesLoading).toBe(false)
  })

  it('商家请求失败不影响活动展示，并保留可重试错误状态', async () => {
    mocks.home.mockRejectedValue(new Error('服务不可用'))
    await page.load()
    expect(page.data.homeError).toBe(true)
    expect(page.data.activities).toHaveLength(1)
    expect(page.data.activitiesError).toBe(false)
  })

  it('旧请求迟到不会覆盖下拉刷新后的内容', async () => {
    let finishOld: (value: HomeData) => void = () => {}
    mocks.home.mockImplementationOnce(
      () =>
        new Promise<HomeData>((resolve) => {
          finishOld = resolve
        }),
    )
    const old = page.load()
    await page.load()
    finishOld({ banners: [], featured_merchants: [{ id: 999 } as MerchantSummary] })
    await old
    expect(page.data.featured).toEqual([])
  })
})
