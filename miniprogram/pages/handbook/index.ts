import { isMockEnabled } from '../../config'
import { getSupportContent } from '../../services/api/support'
import { showError } from '../../services/errors'
import type { HandbookSection } from '../../types/support'

Page({
  data: {
    sections: [] as HandbookSection[],
    loading: false,
    failed: false,
    isDemo: false,
  },

  onLoad() {
    this.setData({ isDemo: isMockEnabled() })
    this.load()
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true, failed: false })
    try {
      const support = await getSupportContent()
      this.setData({ sections: support.handbook })
    } catch (err) {
      this.setData({ failed: true })
      showError(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onContact() {
    wx.navigateTo({ url: '/pages/contact/index' })
  },
})
