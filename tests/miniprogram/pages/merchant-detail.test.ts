import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MerchantDetail } from '../../../miniprogram/types/api'

const mocks = vi.hoisted(() => ({
  merchant: vi.fn(),
  me: vi.fn(),
  login: vi.fn(),
}))

vi.mock('../../../miniprogram/services/api/merchants', () => ({ getMerchant: mocks.merchant }))
vi.mock('../../../miniprogram/services/auth', () => ({
  fetchMe: mocks.me,
  ensureLogin: mocks.login,
  isActiveMember: vi.fn(() => false),
}))

interface DetailPage {
  data: {
    merchant: MerchantDetail | null
    errorMessage: string
    isMember: boolean
    actionText: string
  }
  setData(patch: Partial<DetailPage['data']>): void
  onLoad(query: Record<string, string | undefined>): Promise<void>
  onShow(): Promise<void>
  onOpenMap(): void
}

afterEach(() => vi.unstubAllGlobals())

describe('公开商家详情', () => {
  it('登录和会员服务失败时仍加载商家地址，并可打开地图导航', async () => {
    const merchant: MerchantDetail = {
      id: 1,
      name: '测试商家',
      logo_url: '',
      category: { id: 1, name: '餐饮' },
      area: { id: 1, name: 'Clayton' },
      discount_summary: '测试优惠',
      intro: '测试商家介绍',
      discount_terms: '测试使用条件',
      image_urls: [],
      address: '测试地址 Clayton VIC',
      latitude: -37.9105,
      longitude: 145.134,
      phone: '',
      opening_hours: '待公布',
    }
    mocks.merchant.mockResolvedValue(merchant)
    mocks.me.mockRejectedValue(new Error('登录服务不可用'))
    mocks.login.mockRejectedValue(new Error('登录服务不可用'))

    const register = vi.fn()
    const openLocation = vi.fn()
    vi.stubGlobal('Page', register)
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
      setNavigationBarTitle: vi.fn(),
      showToast: vi.fn(),
      openLocation,
    })
    await import('../../../miniprogram/pages/merchant-detail/index')
    const definition = register.mock.calls[0][0] as DetailPage
    const page: DetailPage = {
      ...definition,
      data: { ...definition.data },
      setData(patch) {
        Object.assign(this.data, patch)
      },
    }

    await Promise.all([page.onLoad({ id: '1' }), page.onShow()])

    expect(mocks.me).toHaveBeenCalledOnce()
    expect(mocks.login).not.toHaveBeenCalled()
    expect(mocks.merchant).toHaveBeenCalledWith(1)
    expect(page.data.merchant?.address).toBe(merchant.address)
    expect(page.data.errorMessage).toBe('')
    expect(page.data.isMember).toBe(false)

    page.onOpenMap()
    expect(openLocation).toHaveBeenCalledWith({
      latitude: merchant.latitude,
      longitude: merchant.longitude,
      name: merchant.name,
      address: merchant.address,
      scale: 16,
    })
  })
})
