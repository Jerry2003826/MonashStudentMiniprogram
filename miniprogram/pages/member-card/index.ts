import { fetchMe } from '../../services/auth'
import { showError } from '../../services/errors'
import type { Me } from '../../types/api'
import { formatClock, formatDate } from '../../utils/format'
import { memberCardState } from '../../utils/membership'

Page({
  data: {
    me: null as Me | null,
    card: memberCardState(null),
    expiry: '',
    today: '',
    clock: '',
  },

  timer: 0,

  async onShow() {
    this.tick()
    this.startClock()
    wx.setKeepScreenOn({ keepScreenOn: true })
    try {
      const me = await fetchMe()
      const expiresAt = me.membership.expires_at
      this.setData({
        me,
        card: memberCardState(me),
        expiry: expiresAt ? formatDate(expiresAt) : '',
      })
    } catch (err) {
      showError(err)
    }
  },

  onHide() {
    this.stopClock()
    wx.setKeepScreenOn({ keepScreenOn: false })
  },

  onUnload() {
    this.stopClock()
    wx.setKeepScreenOn({ keepScreenOn: false })
  },

  tick() {
    const now = new Date()
    this.setData({ today: formatDate(now.toISOString()), clock: formatClock(now) })
  },

  startClock() {
    this.stopClock()
    this.timer = setInterval(() => this.tick(), 1000)
  },

  stopClock() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = 0
    }
  },

  onAction() {
    wx.navigateTo({ url: this.data.card.actionUrl })
  },
})
