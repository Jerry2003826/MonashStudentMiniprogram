import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMe } from '../helpers/membership'

const mocks = vi.hoisted(() => ({ me: vi.fn(), confirm: vi.fn() }))
vi.mock('../../../miniprogram/services/auth', () => ({ fetchMe: mocks.me }))
vi.mock('../../../miniprogram/services/api/staff', () => ({ confirmStaffLogin: mocks.confirm }))

interface StaffPage {
  data: {
    allowed: boolean
    checking: boolean
    code: string
    confirmed: boolean
    submitting: boolean
  }
  setData(patch: Partial<StaffPage['data']>): void
  load(): Promise<void>
  onCodeInput(event: { detail: { value: string } }): void
  onConfirm(): Promise<void>
}
let page: StaffPage

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('wx', { showToast: vi.fn() })
  const register = vi.fn()
  vi.stubGlobal('Page', register)
  await import('../../../miniprogram/pages/staff-login/index')
  const definition = register.mock.calls[0][0] as StaffPage
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('管理员显式确认后台登录', () => {
  it('普通用户即使直接进入页面，也不能发送确认请求', async () => {
    mocks.me.mockResolvedValue(makeMe())
    await page.load()
    page.data.code = '123456'
    await page.onConfirm()
    expect(page.data.allowed).toBe(false)
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('检查身份和输入确认码不会自动登录，只在点击确认后发送一次', async () => {
    mocks.me.mockResolvedValue(makeMe({}, 'reviewer'))
    await page.load()
    page.onCodeInput({ detail: { value: '123456' } })
    expect(mocks.confirm).not.toHaveBeenCalled()
    let finish!: () => void
    mocks.confirm.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const first = page.onConfirm()
    await page.onConfirm()
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith('123456')
    finish()
    await first
    expect(page.data.confirmed).toBe(true)
    expect(page.data.code).toBe('')
    await page.onConfirm()
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it('确认码被服务端拒绝时不会展示成功，仍可重新填写', async () => {
    mocks.me.mockResolvedValue(makeMe({}, 'editor'))
    await page.load()
    page.onCodeInput({ detail: { value: '123456' } })
    mocks.confirm.mockRejectedValueOnce(new Error('expired'))
    await page.onConfirm()
    expect(page.data.confirmed).toBe(false)
    expect(page.data.submitting).toBe(false)
  })
})
