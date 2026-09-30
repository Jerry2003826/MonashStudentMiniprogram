import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me, MembershipApplication } from '../../../miniprogram/types/api'
import { makeMe } from '../helpers/membership'

const mocks = vi.hoisted(() => ({ me: vi.fn(), config: vi.fn(), send: vi.fn(), apply: vi.fn() }))
vi.mock('../../../miniprogram/services/auth', () => ({ fetchMe: mocks.me }))
vi.mock('../../../miniprogram/services/api/membership', () => ({
  fetchMembershipConfig: mocks.config,
  sendEmailCode: mocks.send,
  verifyEmail: mocks.apply,
}))

interface State {
  me: Me | null
  application: MembershipApplication | null
  email: string
  code: string
  loading: boolean
  loadError: boolean
  canApply: boolean
  canSubmit: boolean
  submitting: boolean
  statusTitle: string
  statusDescription: string
}
interface VerifyPage {
  data: State
  setData(patch: Partial<State>): void
  load(): Promise<void>
  updateCanSubmit(): void
  onSubmit(): Promise<void>
  onSendCode(): Promise<void>
  onViewCard(): void
}

const pending: MembershipApplication = {
  id: 1,
  email: 'a@student.monash.edu',
  status: 'pending',
  submitted_at: '2026-09-28T00:00:00Z',
  reviewed_at: null,
  review_note: '',
}
let page: VerifyPage
let navigate: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.config.mockResolvedValue({ allowed_email_domains: ['student.monash.edu'] })
  navigate = vi.fn()
  vi.stubGlobal('wx', {
    setNavigationBarTitle: vi.fn(),
    showToast: vi.fn(),
    navigateTo: navigate,
    redirectTo: navigate,
  })
  const register = vi.fn()
  vi.stubGlobal('Page', register)
  await import('../../../miniprogram/pages/verify/index')
  const definition = register.mock.calls[0][0] as VerifyPage
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('会员申请页面', () => {
  it('待审时关闭提交和发送验证码，刷新后可看到后台批准结果', async () => {
    mocks.me.mockResolvedValueOnce(makeMe({ application: pending }))
    await page.load()
    page.data.email = pending.email
    page.data.code = '123456'
    page.updateCanSubmit()
    await page.onSubmit()
    await page.onSendCode()
    page.onViewCard()
    expect(page.data.statusTitle).toContain('审核中')
    expect(page.data.canApply).toBe(false)
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()

    mocks.me.mockResolvedValueOnce(
      makeMe({ state: 'active', application: { ...pending, status: 'approved' } }),
    )
    await page.load()
    expect(page.data.me?.membership.state).toBe('active')
    expect(navigate).not.toHaveBeenCalled()
    page.onViewCard()
    expect(navigate).toHaveBeenCalledWith({ url: '/pages/member-card/index' })
  })

  it('拒绝后显示原因并可重新提交，提交成功停留在待审页而不是跳会员卡', async () => {
    mocks.me.mockResolvedValueOnce(
      makeMe({
        application: { ...pending, status: 'rejected', review_note: '请补充当前学期信息' },
      }),
    )
    await page.load()
    expect(page.data.application?.review_note).toBe('请补充当前学期信息')
    expect(page.data.canApply).toBe(true)
    page.data.code = '123456'
    page.updateCanSubmit()
    mocks.apply.mockResolvedValueOnce(makeMe({ application: { ...pending, id: 2 } }))
    await page.onSubmit()
    expect(mocks.apply).toHaveBeenCalledWith(pending.email, '123456')
    expect(page.data.application?.status).toBe('pending')
    expect(page.data.canApply).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('续期待审保留旧会员资格，到期日不由前端修改', async () => {
    const expiresAt = '2026-10-10T00:00:00Z'
    mocks.me.mockResolvedValueOnce(
      makeMe({ state: 'active', renewable: true, expires_at: expiresAt, application: pending }),
    )
    await page.load()
    expect(page.data.statusDescription).toContain('原到期日')
    expect(page.data.me?.membership.expires_at).toBe(expiresAt)
    expect(page.data.canApply).toBe(false)
    page.onViewCard()
    expect(navigate).toHaveBeenCalledWith({ url: '/pages/member-card/index' })
  })

  it('读取申请失败时不能沿用之前的可提交状态', async () => {
    mocks.me.mockResolvedValueOnce(makeMe())
    await page.load()
    page.data.email = pending.email
    page.data.code = '123456'
    page.updateCanSubmit()
    expect(page.data.canSubmit).toBe(true)
    mocks.me.mockRejectedValueOnce(new Error('offline'))
    await page.load()
    await page.onSubmit()
    expect(page.data.loadError).toBe(true)
    expect(page.data.canSubmit).toBe(false)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
