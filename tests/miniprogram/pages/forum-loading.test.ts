import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ boards: vi.fn(), posts: vi.fn(), login: vi.fn() }))
vi.mock('../../../miniprogram/services/api/forum', () => ({
  listBoards: mocks.boards,
  listPosts: mocks.posts,
}))
vi.mock('../../../miniprogram/services/auth', () => ({ ensureLogin: mocks.login }))
vi.mock('../../../miniprogram/services/errors', () => ({ showError: vi.fn() }))
vi.mock('../../../miniprogram/utils/guard', () => ({ ensureMember: vi.fn() }))
vi.mock('../../../miniprogram/utils/refresh', () => ({ consumeDirty: () => false }))
vi.mock('../../../miniprogram/utils/tab-bar', () => ({ syncTabBar: vi.fn() }))

interface ListPage {
  data: {
    items: { id: number }[]
    cursor: string | null
    loaded: boolean
    loading: boolean
    loadFailed: boolean
    boards?: { id: number }[]
  }
  setData(patch: Record<string, unknown>): void
  refresh(): Promise<void>
  loadMore(): Promise<void>
  onRetry(): Promise<void>
}

async function loadPage(kind: 'public' | 'mine'): Promise<ListPage> {
  let page!: ListPage
  vi.stubGlobal('Page', (definition: ListPage) => {
    page = definition
    page.setData = (patch) => Object.assign(page.data, patch)
  })
  if (kind === 'public') await import('../../../miniprogram/pages/forum/index')
  else await import('../../../miniprogram/pages/my-posts/index')
  return page
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.login.mockResolvedValue(undefined)
  mocks.boards.mockResolvedValue([{ id: 1 }])
})
afterEach(() => vi.unstubAllGlobals())

describe.each(['public', 'mine'] as const)('%s 帖子列表失败恢复', (kind) => {
  it('首次失败保留错误状态，重试成功后显示真实空态', async () => {
    const page = await loadPage(kind)
    mocks.posts.mockRejectedValueOnce(new Error('服务未开通'))
    await page.refresh()
    expect(page.data).toMatchObject({ loadFailed: true, loaded: false, loading: false })

    mocks.posts.mockResolvedValueOnce({ items: [], next_cursor: null })
    if (kind === 'public') await page.onRetry()
    else await page.loadMore()
    expect(page.data).toMatchObject({ loadFailed: false, loaded: true, items: [] })
    if (kind === 'public') {
      expect(page.data.boards).toEqual([{ id: 1 }])
      expect(mocks.login).not.toHaveBeenCalled()
    }
  })

  it('分页失败重试保留已有帖子和原游标', async () => {
    const page = await loadPage(kind)
    mocks.posts.mockResolvedValueOnce({ items: [{ id: 1 }], next_cursor: 'next' })
    await page.refresh()
    mocks.posts.mockRejectedValueOnce(new Error('timeout'))
    await page.loadMore()
    expect(page.data).toMatchObject({ items: [{ id: 1 }], cursor: 'next', loadFailed: true })

    mocks.posts.mockResolvedValueOnce({ items: [{ id: 2 }], next_cursor: null })
    await page.loadMore()
    expect(mocks.posts).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next' }))
    expect(page.data).toMatchObject({ items: [{ id: 1 }, { id: 2 }], loadFailed: false })
  })
})

it('我的帖子登录失败也显示重试状态，不误显示没有发帖', async () => {
  const page = await loadPage('mine')
  mocks.login.mockRejectedValueOnce(new Error('offline'))
  await page.refresh()
  expect(page.data).toMatchObject({ loadFailed: true, loaded: false, loading: false })
  expect(mocks.posts).not.toHaveBeenCalled()
})
