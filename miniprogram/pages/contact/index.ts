import { getSupportContent } from '../../services/api/support'
import { showError } from '../../services/errors'
import type { SupportContent } from '../../types/support'

Page({
  data: {
    support: null as SupportContent | null,
    loading: false,
    failed: false,
  },

  onLoad() {
    this.load()
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true, failed: false })
    try {
      this.setData({ support: await getSupportContent() })
    } catch (err) {
      this.setData({ failed: true })
      showError(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onCopyWechat() {
    const wechat = this.data.support?.assistant_wechat
    if (wechat) wx.setClipboardData({ data: wechat })
  },

  onCopyWebsite() {
    const website = this.data.support?.website_url
    if (website) wx.setClipboardData({ data: website })
  },

  onFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' })
  },
})
