import { isMockEnabled } from '../../config'
import { confirmStaffLogin } from '../../services/api/staff'
import { fetchMe } from '../../services/auth'
import { showError } from '../../services/errors'

Page({
  data: {
    code: '',
    checking: true,
    allowed: false,
    loadError: false,
    submitting: false,
    confirmed: false,
    mockMode: false,
  },

  requestSeq: 0,

  onLoad() {
    this.setData({ mockMode: isMockEnabled() })
  },

  onShow() {
    this.load()
  },

  onUnload() {
    this.requestSeq += 1
  },

  async load() {
    if (this.data.submitting || this.data.confirmed) return
    const seq = ++this.requestSeq
    this.setData({ checking: true, allowed: false, loadError: false })
    try {
      const me = await fetchMe()
      if (seq === this.requestSeq)
        this.setData({ allowed: ['owner', 'reviewer', 'editor'].includes(me.staff_role ?? '') })
    } catch (err) {
      if (seq === this.requestSeq) {
        this.setData({ loadError: true })
        showError(err)
      }
    } finally {
      if (seq === this.requestSeq) this.setData({ checking: false })
    }
  },

  onCodeInput(e: WechatMiniprogram.Input) {
    if (!this.data.allowed || this.data.submitting || this.data.confirmed) return
    this.setData({ code: e.detail.value.replace(/\D/g, '').slice(0, 6) })
  },

  async onConfirm() {
    if (!this.data.allowed || this.data.checking || this.data.submitting || this.data.confirmed)
      return
    const code = this.data.code
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: '请输入浏览器显示的 6 位确认码', icon: 'none' })
      return
    }
    const seq = ++this.requestSeq
    this.setData({ submitting: true })
    try {
      await confirmStaffLogin(code)
      if (seq === this.requestSeq) this.setData({ confirmed: true, code: '' })
    } catch (err) {
      if (seq === this.requestSeq) showError(err)
    } finally {
      if (seq === this.requestSeq) this.setData({ submitting: false })
    }
  },
})
