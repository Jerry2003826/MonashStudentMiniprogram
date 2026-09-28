import { isMockEnabled } from '../../config'
import { getTestingLabel } from '../../deployment'
import { listActivities } from '../../services/api/activities'
import { getHome } from '../../services/api/home'
import { fetchMe } from '../../services/auth'
import type { ActivitySummary } from '../../types/activities'
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
    activitiesLoading: true,
    homeError: false,
    activitiesError: false,
    dateLabel: '',
    demo: false,
    testingLabel: '',
    activities: [] as ActivitySummary[],
    banners: [] as Banner[],
    featured: [] as MerchantSummary[],
    entry: memberEntry(null),
  },

  requestSeq: 0,

  onShow() {
    syncTabBar(this, 'home')
    const now = new Date()
    this.setData({
      dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 · 周${'日一二三四五六'[now.getDay()]}`,
      demo: isMockEnabled(),
      testingLabel: getTestingLabel(),
    })
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    const seq = ++this.requestSeq
    this.setData({
      loading: true,
      activitiesLoading: true,
      homeError: false,
      activitiesError: false,
    })
    // 公开内容和会员状态独立加载，登录服务失败不会挡住活动和商家。
    await Promise.all([
      getHome()
        .then((home) => {
          if (seq === this.requestSeq)
            this.setData({ banners: home.banners, featured: home.featured_merchants })
        })
        .catch(() => {
          if (seq === this.requestSeq) this.setData({ homeError: true })
        })
        .finally(() => {
          if (seq === this.requestSeq) this.setData({ loading: false })
        }),
      listActivities({ category: 'latest' })
        .then((page) => {
          if (seq === this.requestSeq) this.setData({ activities: page.items.slice(0, 3) })
        })
        .catch(() => {
          if (seq === this.requestSeq) this.setData({ activitiesError: true })
        })
        .finally(() => {
          if (seq === this.requestSeq) this.setData({ activitiesLoading: false })
        }),
      fetchMe()
        .then((me) => {
          if (seq === this.requestSeq) this.setData({ entry: memberEntry(me) })
        })
        .catch(() => {
          if (seq === this.requestSeq) this.setData({ entry: memberEntry(null) })
        }),
    ])
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

  onMoreActivities() {
    wx.switchTab({ url: '/pages/activities/index' })
  },

  onActivityTap(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/activity-detail/index?id=${e.currentTarget.dataset.id}` })
  },

  onHandbook() {
    wx.navigateTo({ url: '/pages/handbook/index' })
  },

  onContact() {
    wx.navigateTo({ url: '/pages/contact/index' })
  },

  onServiceInfo() {
    wx.showModal({
      title: '生活服务正在准备',
      content: '天气和人民币兑澳元汇率接入后，将同时显示数据来源和更新时间。',
      showCancel: false,
    })
  },

  onShareAppMessage() {
    return { title: '蒙纳士中国学生会 · 活动、社区与会员优惠', path: '/pages/home/index' }
  },
})
