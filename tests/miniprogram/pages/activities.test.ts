import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listActivities } from '../../../miniprogram/services/api/activities'
import type { ActivityCategory, ActivitySummary } from '../../../miniprogram/types/activities'
import type { Paginated } from '../../../miniprogram/types/api'

vi.mock('../../../miniprogram/services/api/activities', () => ({ listActivities: vi.fn() }))

interface ActivityPageData {
  category: ActivityCategory
  keyword: string
  items: ActivitySummary[]
  featured: ActivitySummary[]
  cursor: string | null
  hasMore: boolean
  loading: boolean
  loaded: boolean
  errorMessage: string
  hasExamples: boolean
}

interface ActivityPage {
  data: ActivityPageData
  requestSeq: number
  setData(patch: Partial<ActivityPageData>): void
  refresh(): Promise<void>
  fetchPage(): Promise<void>
  onUnload(): void
}

function activity(id: number, category: ActivityCategory): ActivitySummary {
  return {
    id,
    category,
    title: `示例 ${id}`,
    summary: '测试内容',
    starts_at: null,
    location: '待公布',
    is_example: true,
  }
}

let page: ActivityPage

beforeEach(async () => {
  vi.resetModules()
  vi.mocked(listActivities).mockReset()
  vi.stubGlobal('Page', (options: ActivityPage) => {
    page = options
    page.setData = (patch) => Object.assign(page.data, patch)
  })
  await import('../../../miniprogram/pages/activities/index')
})

afterEach(() => vi.unstubAllGlobals())

describe('活动列表交互', () => {
  it('分类快速切换时仅应用最后一个请求的结果', async () => {
    let resolveFirst!: (value: Paginated<ActivitySummary>) => void
    vi.mocked(listActivities).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    const first = page.refresh()
    page.data.category = 'news'
    vi.mocked(listActivities).mockResolvedValueOnce({
      items: [activity(5, 'news')],
      next_cursor: null,
    })
    await page.refresh()
    resolveFirst({ items: [activity(1, 'latest')], next_cursor: null })
    await first

    expect(page.data.items.map((item) => item.id)).toEqual([5])
    expect(page.data.loading).toBe(false)
  })

  it('加载更多失败保留已有列表，重试继续原分页且轮播始终只有前三项', async () => {
    vi.mocked(listActivities).mockResolvedValueOnce({
      items: [1, 2, 3].map((id) => activity(id, 'latest')),
      next_cursor: '3',
    })
    await page.refresh()
    vi.mocked(listActivities).mockRejectedValueOnce(new Error('offline'))
    await page.fetchPage()
    expect(page.data.items).toHaveLength(3)
    expect(page.data.cursor).toBe('3')
    expect(page.data.errorMessage).not.toBe('')

    vi.mocked(listActivities).mockResolvedValueOnce({
      items: [activity(4, 'latest')],
      next_cursor: null,
    })
    await page.fetchPage()
    expect(listActivities).toHaveBeenLastCalledWith({
      category: 'latest',
      q: undefined,
      cursor: '3',
    })
    expect(page.data.items).toHaveLength(4)
    expect(page.data.featured.map((item) => item.id)).toEqual([1, 2, 3])
    expect(page.data.hasMore).toBe(false)
    expect(page.data.errorMessage).toBe('')
  })

  it('页面卸载后不再应用响应', async () => {
    let resolveRequest!: (value: Paginated<ActivitySummary>) => void
    vi.mocked(listActivities).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
    )
    const request = page.refresh()
    page.onUnload()
    resolveRequest({ items: [activity(1, 'latest')], next_cursor: null })
    await request
    expect(page.data.items).toEqual([])
  })
})
