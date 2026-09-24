import { getHome } from '../../services/api/home'
import { ensureLogin, fetchMe } from '../../services/auth'
import { showError } from '../../services/errors'
import type { Banner, MerchantSummary } from '../../types/api'
import { memberEntry } from '../../utils/membership'
import { syncTabBar } from '../../utils/tab-bar'

function bannerUrl(banner: Banner): string | null {
  switch (banner.link_type) {
    case 'merchant':
      return `/pages/merchant-detail/index?id=${banner.link_id}`
    case 'post':
      return `/pages/post-detail/index?id=${banner.link_id}`
    case 'none':
      return null
    default: {
      const unreachable: never = banner.link_type
      return unreachable
    }
  }
}

Page({
  data: {
    loading: true,
    banners: [] as Banner[],
    featured: [] as MerchantSummary[],
    entry: memberEntry(null),
  },

  onShow() {
    syncTabBar(this, 'home')
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    try {
      await ensureLogin()
      const [home, me] = await Promise.all([getHome(), fetchMe()])
      this.setData({
        banners: home.banners,
        featured: home.featured_merchants,
        entry: memberEntry(me),
      })
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onBannerTap(e: WechatMiniprogram.TouchEvent) {
    const banner = this.data.banners[Number(e.currentTarget.dataset.index)]
    const url = banner ? bannerUrl(banner) : null
    if (url) wx.navigateTo({ url })
  },

  onEntryTap() {
    wx.navigateTo({ url: this.data.entry.url })
  },

  onMoreMerchants() {
    wx.switchTab({ url: '/pages/merchants/index' })
  },
})
