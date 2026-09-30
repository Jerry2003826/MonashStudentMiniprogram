import { getDevelopmentLoginUsername, isMockEnabled } from '../../config'
import { getTestingLabel } from '../../deployment'
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
    loading: true,
    loadFailed: false,
    demo: false,
    testingLabel: '',
  },

  timer: null as ReturnType<typeof setInterval> | null,
  revalidationTimer: null as ReturnType<typeof setInterval> | null,
  requestSeq: 0,

  onLoad() {
    this.setData({
      demo: isMockEnabled() || getDevelopmentLoginUsername() !== null,
      testingLabel: getTestingLabel(),
    })
  },

  async onShow() {
    this.tick()
    this.startClock()
    wx.setKeepScreenOn({ keepScreenOn: true })
    await this.revalidate()
  },

  async revalidate(notify = true) {
    const seq = ++this.requestSeq
    // A stalled or failed server check must never leave the old active card visible.
    this.setData({ loading: true, loadFailed: false, me: null, card: memberCardState(null) })
    try {
      const me = await fetchMe()
      if (seq !== this.requestSeq) return
      const expiresAt = me.membership.expires_at
      this.setData({
        me,
        card: memberCardState(me),
        expiry: expiresAt ? formatDate(expiresAt) : '',
      })
    } catch (err) {
      if (seq === this.requestSeq) {
        this.setData({ loadFailed: true })
        if (notify) showError(err)
      }
    } finally {
      if (seq === this.requestSeq) this.setData({ loading: false })
    }
  },

  onHide() {
    this.requestSeq += 1
    this.stopClock()
    wx.setKeepScreenOn({ keepScreenOn: false })
  },

  onUnload() {
    this.requestSeq += 1
    this.stopClock()
    wx.setKeepScreenOn({ keepScreenOn: false })
  },

  tick() {
    const now = new Date()
    this.setData({ today: formatDate(now.toISOString()), clock: formatClock(now) })
    const me = this.data.me
    if (
      me?.membership.state === 'active' &&
      me.membership.expires_at &&
      Date.parse(me.membership.expires_at) <= now.getTime()
    ) {
      const expired: Me = {
        ...me,
        membership: { ...me.membership, state: 'expired', renewable: true },
      }
      this.setData({ me: expired, card: memberCardState(expired) })
    }
  },

  startClock() {
    this.stopClock()
    this.timer = setInterval(() => this.tick(), 1000)
    // Timers do not depend on the device wall clock. Recheck even if it is moved back.
    this.revalidationTimer = setInterval(() => {
      if (!this.data.loading) void this.revalidate(false)
    }, 30_000)
  },

  stopClock() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.revalidationTimer) {
      clearInterval(this.revalidationTimer)
      this.revalidationTimer = null
    }
  },

  onAction() {
    wx.navigateTo({ url: this.data.card.actionUrl })
  },
})
