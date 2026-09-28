import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getActivity } from '../../../miniprogram/services/api/activities'
import type { ActivityDetail } from '../../../miniprogram/types/activities'

vi.mock('../../../miniprogram/services/api/activities', () => ({ getActivity: vi.fn() }))

interface DetailPage {
  data: {
    activity: ActivityDetail | null
    errorMessage: string
    loading: boolean
    dateText: string
    categoryLabel: string
  }
  activityId: number
  requestSeq: number
  setData(patch: Partial<DetailPage['data']>): void
  load(): Promise<void>
  onOpenArticle(): void
  offerCopyArticle(url: string): void
  onShareAppMessage(): { title: string; path: string }
}

const detail: ActivityDetail = {
  id: 1,
  category: 'latest',
  title: '迎新预览',
  summary: '示例',
  starts_at: null,
  location: '待公布',
  is_example: true,
  content: '示例内容',
  article_url: null,
}

let page: DetailPage
let modal: ReturnType<typeof vi.fn>
let clipboard: ReturnType<typeof vi.fn>
let openArticle: ReturnType<typeof vi.fn>
let canIUse: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  vi.mocked(getActivity).mockReset()
  modal = vi.fn()
  clipboard = vi.fn()
  openArticle = vi.fn()
  canIUse = vi.fn(() => true)
  vi.stubGlobal('wx', {
    canIUse,
    openOfficialAccountArticle: openArticle,
    showModal: modal,
    setClipboardData: clipboard,
    setNavigationBarTitle: vi.fn(),
    showToast: vi.fn(),
  })
  vi.stubGlobal('Page', (options: DetailPage) => {
    page = options
    page.setData = (patch) => Object.assign(page.data, patch)
  })
  await import('../../../miniprogram/pages/activity-detail/index')
})

afterEach(() => vi.unstubAllGlobals())

describe('活动详情与公众号文章', () => {
  it('错误分享参数不发请求，加载成功后的分享保留示例标识和详情路径', async () => {
    page.activityId = NaN
    await page.load()
    expect(getActivity).not.toHaveBeenCalled()
    expect(page.data.errorMessage).toContain('链接无效')

    page.activityId = 1
    vi.mocked(getActivity).mockResolvedValueOnce(detail)
    await page.load()
    expect(page.onShareAppMessage()).toEqual({
      title: '【示例】迎新预览',
      path: '/pages/activity-detail/index?id=1',
    })
    expect(page.data.dateText).toBe('时间待官方公布')
  })

  it('没有原文和非公众号链接不会发起外部导航', () => {
    page.data.activity = { ...detail }
    page.onOpenArticle()
    page.data.activity.article_url = 'https://example.com/article'
    page.onOpenArticle()
    expect(openArticle).not.toHaveBeenCalled()
    expect(modal).not.toHaveBeenCalled()
  })

  it('公众号打开失败后先征求复制确认，取消时不写剪贴板', () => {
    const url = 'https://mp.weixin.qq.com/s/test-article'
    page.data.activity = { ...detail, article_url: url }
    openArticle.mockImplementation(({ fail }: { fail: () => void }) => fail())
    page.onOpenArticle()
    expect(openArticle).toHaveBeenCalledWith(expect.objectContaining({ url }))
    expect(clipboard).not.toHaveBeenCalled()
    const { success } = modal.mock.calls[0][0] as {
      success: (result: { confirm: boolean }) => void
    }
    success({ confirm: false })
    expect(clipboard).not.toHaveBeenCalled()
    success({ confirm: true })
    expect(clipboard).toHaveBeenCalledWith(expect.objectContaining({ data: url }))
  })

  it('低版本微信提供复制确认，并不调用不可用接口', () => {
    canIUse.mockReturnValue(false)
    page.data.activity = { ...detail, article_url: 'https://mp.weixin.qq.com/s/test-article' }
    page.onOpenArticle()
    expect(openArticle).not.toHaveBeenCalled()
    expect(modal).toHaveBeenCalledOnce()
    expect(clipboard).not.toHaveBeenCalled()
  })
})
