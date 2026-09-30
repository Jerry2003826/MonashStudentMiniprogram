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
  onUnload(): void
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

describe('会员卡服务器定期复核', () => {
  const active = () =>
    makeMe({ state: 'active', member_no: '123', expires_at: '2027-09-28T00:00:00Z' })

  it.each(['expired', 'revoked'] as const)(
    '设备时间被调回后仍按服务器的 %s 状态撤下有效卡',
    async (state) => {
      vi.setSystemTime(new Date('2026-09-28T00:00:00Z'))
      mocks.me
        .mockResolvedValueOnce(active())
        .mockResolvedValueOnce(makeMe({ state, expires_at: '2027-09-28T00:00:00Z' }))
      await page.onShow()
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mocks.me).toHaveBeenCalledTimes(2)
      expect(page.data.me?.membership.state).toBe(state)
      expect(page.data.card.variant).toBe('inactive')
    },
  )

  it('定期请求未完成即收起有效卡，慢请求期间不重叠发起核验', async () => {
    mocks.me.mockResolvedValueOnce(active()).mockImplementationOnce(() => new Promise(() => {}))
    await page.onShow()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(page.data).toMatchObject({ loading: true, card: { variant: 'empty' } })
    await vi.advanceTimersByTimeAsync(90_000)
    expect(mocks.me).toHaveBeenCalledTimes(2)
    expect(page.data.card.variant).toBe('empty')
  })

  it('定期核验失败时不可出示旧卡，下次成功后才能恢复', async () => {
    mocks.me
      .mockResolvedValueOnce(active())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(active())
    await page.onShow()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(page.data).toMatchObject({
      loading: false,
      loadFailed: true,
      card: { variant: 'empty' },
    })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(page.data).toMatchObject({
      loading: false,
      loadFailed: false,
      card: { variant: 'active' },
    })
  })

  it.each(['onHide', 'onUnload'] as const)('%s 停止全部定时器并忽略迟到响应', async (method) => {
    let resolve!: (me: Me) => void
    mocks.me.mockResolvedValueOnce(active()).mockImplementationOnce(
      () =>
        new Promise<Me>((done) => {
          resolve = done
        }),
    )
    await page.onShow()
    await vi.advanceTimersByTimeAsync(30_000)
    page[method]()
    resolve(active())
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(mocks.me).toHaveBeenCalledTimes(2)
    expect(page.data.card.variant).toBe('empty')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('重新展示只保留一组定时器，旧请求不能覆盖新的核验结果', async () => {
    let resolve!: (me: Me) => void
    mocks.me
      .mockImplementationOnce(
        () =>
          new Promise<Me>((done) => {
            resolve = done
          }),
      )
      .mockResolvedValueOnce(makeMe({ state: 'revoked' }))
    const old = page.onShow()
    page.onHide()
    await page.onShow()
    resolve(active())
    await old
    expect(page.data.me?.membership.state).toBe('revoked')
    expect(page.data.card.variant).toBe('inactive')
    expect(vi.getTimerCount()).toBe(2)
  })
})
