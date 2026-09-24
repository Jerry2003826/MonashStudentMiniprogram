import { isMockEnabled, MOCK_VERIFICATION_CODE } from '../../config'
import { sendEmailCode, verifyEmail } from '../../services/api/membership'
import { fetchMe } from '../../services/auth'
import { showError } from '../../services/errors'
import { CARD_URL } from '../../utils/membership'
import { isStudentEmail, normalizeEmail } from '../../utils/validate'

const RESEND_SECONDS = 60
const CODE_PATTERN = /^\d{6}$/

Page({
  data: {
    email: '',
    code: '',
    countdown: 0,
    sending: false,
    submitting: false,
    canSubmit: false,
    renewing: false,
    mockMode: false,
    mockCode: MOCK_VERIFICATION_CODE,
  },

  timer: 0,

  async onLoad() {
    this.setData({ mockMode: isMockEnabled() })
    try {
      const { membership } = await fetchMe()
      const renewing =
        membership.state === 'expired' || (membership.state === 'active' && membership.renewable)
      if (renewing) {
        this.setData({ renewing, email: membership.email ?? '' })
        wx.setNavigationBarTitle({ title: '续期会员' })
      }
    } catch (err) {
      showError(err)
    }
  },

  onUnload() {
    this.stopCountdown()
  },

  onEmailChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ email: e.detail.value })
    this.updateCanSubmit()
  },

  onEmailClear() {
    this.setData({ email: '' })
    this.updateCanSubmit()
  },

  onCodeChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ code: e.detail.value })
    this.updateCanSubmit()
  },

  updateCanSubmit() {
    const { email, code } = this.data
    this.setData({ canSubmit: isStudentEmail(email) && CODE_PATTERN.test(code) })
  },

  async onSendCode() {
    if (this.data.countdown > 0 || this.data.sending) return
    if (!isStudentEmail(this.data.email)) {
      wx.showToast({ title: '请使用 @student.monash.edu 学生邮箱', icon: 'none' })
      return
    }
    this.setData({ sending: true })
    try {
      await sendEmailCode(normalizeEmail(this.data.email))
      wx.showToast({ title: '验证码已发送', icon: 'success' })
      this.startCountdown()
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ sending: false })
    }
  },

  startCountdown() {
    this.stopCountdown()
    this.setData({ countdown: RESEND_SECONDS })
    this.timer = setInterval(() => {
      const next = this.data.countdown - 1
      this.setData({ countdown: next })
      if (next <= 0) this.stopCountdown()
    }, 1000)
  },

  stopCountdown() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = 0
    }
  },

  async onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    this.setData({ submitting: true })
    try {
      await verifyEmail(normalizeEmail(this.data.email), this.data.code)
      wx.showToast({ title: this.data.renewing ? '续期成功' : '认证成功', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: CARD_URL }), 800)
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },
})
