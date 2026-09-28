import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me, MembershipApplication } from '../../../miniprogram/types/api'
import { makeMe } from '../helpers/membership'

const mocks = vi.hoisted(() => ({ me: vi.fn() }))
vi.mock('../../../miniprogram/services/auth', () => ({ fetchMe: mocks.me }))

interface CardPage {
  data: { me: Me | null; card: { variant: string }; loading: boolean; loadFailed: boolean }
  setData(patch: Partial<CardPage['data']>): void
  onShow(): Promise<void>
  onHide(): void
}
let page: CardPage

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('wx', { setKeepScreenOn: vi.fn(), showToast: vi.fn() })
  const register = vi.fn()
  vi.stubGlobal('Page', register)
  await import('../../../miniprogram/pages/member-card/index')
  const definition = register.mock.calls[0][0] as CardPage
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
})

afterEach(() => {
  page.onHide()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('会员卡资格展示', () => {
  it('停留在卡面期间越过原到期日，也不能以待审续期延长有效卡', async () => {
    vi.setSystemTime(new Date('2026-09-28T00:00:00Z'))
    mocks.me.mockResolvedValueOnce(
      makeMe({
        state: 'active',
        expires_at: '2026-09-28T00:00:01Z',
        renewable: true,
        application: {
          id: 2,
          email: 'a@student.monash.edu',
          status: 'pending',
          submitted_at: '2026-09-27T00:00:00Z',
          reviewed_at: null,
          review_note: '',
        },
      }),
    )
    await page.onShow()
    expect(page.data.card.variant).toBe('active')
    vi.advanceTimersByTime(1000)
    expect(page.data.me?.membership.state).toBe('expired')
    expect(page.data.card.variant).toBe('inactive')
  })

  it.each(['pending', 'rejected'] as const)('%s 申请没有有效卡面', async (status) => {
    const application: MembershipApplication = {
      id: 1,
      email: 'a@student.monash.edu',
      status,
      submitted_at: '2026-09-28T00:00:00Z',
      reviewed_at: null,
      review_note: '',
    }
    mocks.me.mockResolvedValueOnce(makeMe({ application }))
    await page.onShow()
    expect(page.data.card.variant).toBe('empty')
    expect(page.data.loading).toBe(false)
  })

  it('上次有效卡不能在重新核验失败后继续显示为有效', async () => {
    mocks.me.mockResolvedValueOnce(
      makeMe({ state: 'active', member_no: '123', expires_at: '2027-09-28T00:00:00Z' }),
    )
    await page.onShow()
    expect(page.data.card.variant).toBe('active')
    page.onHide()
    mocks.me.mockRejectedValueOnce(new Error('offline'))
    await page.onShow()
    expect(page.data.loadFailed).toBe(true)
    expect(page.data.card.variant).toBe('empty')
  })
})
