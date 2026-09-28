import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMockEnabled } from '../../../miniprogram/config'
import { submitFeedback } from '../../../miniprogram/services/api/support'
import { ensureLogin } from '../../../miniprogram/services/auth'
import { showError } from '../../../miniprogram/services/errors'
import type { FeedbackCategory } from '../../../miniprogram/types/support'

vi.mock('../../../miniprogram/config', () => ({
  getDevelopmentLoginUsername: () => null,
  isMockEnabled: vi.fn(() => true),
}))
vi.mock('../../../miniprogram/services/api/support', () => ({ submitFeedback: vi.fn() }))
vi.mock('../../../miniprogram/services/auth', () => ({ ensureLogin: vi.fn() }))
vi.mock('../../../miniprogram/services/errors', () => ({ showError: vi.fn() }))

interface FeedbackPage {
  data: {
    category: FeedbackCategory
    content: string
    contact: string
    canSubmit: boolean
    submitting: boolean
    isDemo: boolean
    receiptId: number
  }
  setData(update: Partial<FeedbackPage['data']>): void
  onLoad(): void
  onSubmit(): Promise<void>
}

let page: FeedbackPage

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.mocked(ensureLogin).mockResolvedValue(undefined)
  vi.mocked(isMockEnabled).mockReturnValue(true)
  vi.stubGlobal('Page', (options: FeedbackPage) => {
    page = options
    page.setData = (update) => Object.assign(page.data, update)
  })
  vi.stubGlobal('wx', { showToast: vi.fn() })
  await import('../../../miniprogram/pages/feedback/index')
  page.onLoad()
  page.setData({ content: '这里是一条描述明确的页面问题反馈。', contact: 'demo' })
})

afterEach(() => vi.unstubAllGlobals())

describe('反馈页面提交流程', () => {
  it('等待登录期间的重复点击不会再次登录或产生第二条反馈', async () => {
    let finishLogin!: () => void
    vi.mocked(ensureLogin).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLogin = resolve
        }),
    )
    vi.mocked(submitFeedback).mockResolvedValue({ id: 1 })
    const first = page.onSubmit()
    const second = page.onSubmit()
    expect(page.data.submitting).toBe(true)
    expect(ensureLogin).toHaveBeenCalledTimes(1)
    finishLogin()
    await Promise.all([first, second])
    expect(submitFeedback).toHaveBeenCalledTimes(1)
    expect(page.data).toMatchObject({
      receiptId: 1,
      submitting: false,
      isDemo: true,
      content: '',
      contact: '',
    })
    await page.onSubmit()
    expect(submitFeedback).toHaveBeenCalledTimes(1)
  })

  it('提交失败保留内容、关闭忙碌状态且不显示成功结果，可直接重试', async () => {
    const error = new Error('暂时无法提交')
    vi.mocked(submitFeedback).mockRejectedValueOnce(error)
    const draft = page.data.content
    await page.onSubmit()
    expect(showError).toHaveBeenCalledWith(error)
    expect(page.data).toMatchObject({
      content: draft,
      contact: 'demo',
      receiptId: 0,
      submitting: false,
    })
    vi.mocked(submitFeedback).mockResolvedValue({ id: 2 })
    await page.onSubmit()
    expect(page.data.receiptId).toBe(2)
  })

  it('正式接口模式保留真实模式标记，登录失败也不能显示提交成功', async () => {
    vi.mocked(isMockEnabled).mockReturnValue(false)
    page.onLoad()
    const error = new Error('登录失败')
    vi.mocked(ensureLogin).mockRejectedValue(error)
    await page.onSubmit()
    expect(page.data).toMatchObject({ isDemo: false, receiptId: 0, submitting: false })
    expect(submitFeedback).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith(error)
  })
})
