import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupportContent, submitFeedback } from '../../../miniprogram/services/api/support'
import { request } from '../../../miniprogram/services/request'
import type { FeedbackResult } from '../../../miniprogram/types/support'

vi.mock('../../../miniprogram/services/request', () => ({ request: vi.fn() }))

beforeEach(() => {
  vi.mocked(request).mockReset()
})

describe('支持内容和反馈 API', () => {
  it('公开内容明确使用无认证请求', async () => {
    vi.mocked(request).mockResolvedValue({
      handbook: [],
      website_url: null,
      assistant_wechat: null,
    })
    await getSupportContent()
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/support', auth: false })
  })

  it('同一内容连续提交只发送一个认证请求，完成后允许再次提交', async () => {
    let finish!: (value: FeedbackResult) => void
    vi.mocked(request).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = submitFeedback({
      category: 'suggestion',
      content: '  增加更详细的校园导览内容  ',
      contact: '  ',
    })
    const second = submitFeedback({ category: 'suggestion', content: '增加更详细的校园导览内容' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/feedback',
      body: { category: 'suggestion', content: '增加更详细的校园导览内容' },
    })
    finish({ id: 1 })
    await expect(first).resolves.toEqual({ id: 1 })
    await expect(second).resolves.toEqual({ id: 1 })
    vi.mocked(request).mockResolvedValue({ id: 2 })
    await expect(
      submitFeedback({ category: 'suggestion', content: '增加更详细的校园导览内容' }),
    ).resolves.toEqual({ id: 2 })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('失败后释放提交锁，保留错误供页面提示并允许重试', async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error('网络失败'))
    const body = {
      category: 'bug' as const,
      content: '点击活动详情时页面出现错误。',
      contact: ' demo ',
    }
    await expect(submitFeedback(body)).rejects.toThrow('网络失败')
    vi.mocked(request).mockResolvedValue({ id: 3 })
    await expect(submitFeedback(body)).resolves.toEqual({ id: 3 })
    expect(request).toHaveBeenLastCalledWith({
      method: 'POST',
      path: '/feedback',
      body: { ...body, contact: 'demo' },
    })
  })
})
