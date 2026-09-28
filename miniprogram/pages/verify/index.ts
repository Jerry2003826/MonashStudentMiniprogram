import { isMockEnabled, MOCK_VERIFICATION_CODE } from '../../config'
import { sendEmailCode, verifyEmail } from '../../services/api/membership'
import { fetchMe } from '../../services/auth'
import { showError } from '../../services/errors'
import type { Me, MembershipApplication } from '../../types/api'
import { CARD_URL } from '../../utils/membership'
import { isStudentEmail, normalizeEmail } from '../../utils/validate'

const RESEND_SECONDS = 60
const CODE_PATTERN = /^\d{6}$/

Page({
  data: {
    me: null as Me | null,
    application: null as MembershipApplication | null,
    email: '',
    code: '',
    countdown: 0,
    loading: true,
    loadError: false,
    sending: false,
    submitting: false,
    canSubmit: false,
    canApply: false,
    renewing: false,
    statusTitle: '',
    statusDescription: '',
    mockMode: false,
    mockCode: MOCK_VERIFICATION_CODE,
  },

  timer: null as ReturnType<typeof setInterval> | null,
  requestSeq: 0,

  onLoad() {
    this.setData({ mockMode: isMockEnabled() })
  },

  onShow() {
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  onUnload() {
    this.requestSeq += 1
    this.stopCountdown()
  },

  async load() {
    if (this.data.submitting) return
    const seq = ++this.requestSeq
    this.setData({ loading: true, loadError: false })
    try {
      const me = await fetchMe()
      if (seq === this.requestSeq) this.applyMe(me)
    } catch (err) {
      if (seq === this.requestSeq) {
        this.setData({ loadError: true, canSubmit: false })
        showError(err)
      }
    } finally {
      if (seq === this.requestSeq) this.setData({ loading: false })
    }
  },

  applyMe(me: Me) {
    const { membership } = me
    const application = membership.application
    const pending = application?.status === 'pending'
    const renewing =
      membership.state === 'expired' || (membership.state === 'active' && membership.renewable)
    const canApply =
      !pending && membership.state !== 'revoked' && (membership.state === 'none' || renewing)
    let statusTitle = '申请会员'
    let statusDescription =
      '验证学生邮箱并提交申请，由学生会人工审核。审核通过后可使用会员卡和会员功能。'
    if (membership.state === 'revoked') {
      statusTitle = '会员资格已取消'
      statusDescription = '当前不能自行申请，请联系学生会了解情况。'
    } else if (pending) {
      statusTitle = renewing ? '续期申请审核中' : '会员申请审核中'
      statusDescription =
        membership.state === 'active'
          ? '当前会员资格仍有效至原到期日。续期申请通过审核后才会延长有效期。'
          : '申请已提交，正在等待学生会人工审核。审核通过前不能使用会员卡或会员专属功能。'
    } else if (application?.status === 'rejected' && canApply) {
      statusTitle = '申请未通过'
      statusDescription = '请根据下方审核意见修改后重新申请。'
    } else if (membership.state === 'active' && !membership.renewable) {
      statusTitle = '会员资格有效'
      statusDescription = '你的申请已通过审核，可出示会员卡。到期前 30 天开放续期申请。'
    } else if (renewing) {
      statusTitle = '申请会员续期'
      statusDescription = '验证学生邮箱并提交续期申请。人工审核通过后才会更新会员有效期。'
    }
    this.setData({
      me,
      application,
      renewing,
      canApply,
      statusTitle,
      statusDescription,
      email: membership.email ?? application?.email ?? this.data.email,
      ...(pending ? { code: '' } : {}),
    })
    if (pending) this.stopCountdown()
    this.updateCanSubmit()
    wx.setNavigationBarTitle({ title: '会员申请' })
  },

  onEmailChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.canApply || this.data.submitting || this.data.renewing) return
    this.setData({ email: e.detail.value })
    this.updateCanSubmit()
  },

  onEmailClear() {
    if (!this.data.canApply || this.data.submitting || this.data.renewing) return
    this.setData({ email: '' })
    this.updateCanSubmit()
  },

  onCodeChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.canApply || this.data.submitting) return
    this.setData({ code: e.detail.value })
    this.updateCanSubmit()
  },

  updateCanSubmit() {
    const { email, code, canApply, loadError } = this.data
    this.setData({
      canSubmit: canApply && !loadError && isStudentEmail(email) && CODE_PATTERN.test(code),
    })
  },

  async onSendCode() {
    if (
      !this.data.canApply ||
      this.data.loading ||
      this.data.loadError ||
      this.data.submitting ||
      this.data.countdown > 0 ||
      this.data.sending
    )
      return
    if (!isStudentEmail(this.data.email)) {
      wx.showToast({ title: '请使用 @student.monash.edu 学生邮箱', icon: 'none' })
      return
    }
    this.setData({ sending: true })
    try {
      await sendEmailCode(normalizeEmail(this.data.email))
      wx.showToast({
        title: this.data.mockMode ? '演示验证码已准备' : '验证码已发送',
        icon: 'success',
      })
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
      this.timer = null
    }
    this.setData({ countdown: 0 })
  },

  async onSubmit() {
    if (
      !this.data.canSubmit ||
      !this.data.canApply ||
      this.data.loading ||
      this.data.sending ||
      this.data.submitting
    )
      return
    const seq = ++this.requestSeq
    this.setData({ submitting: true })
    try {
      const me = await verifyEmail(normalizeEmail(this.data.email), this.data.code)
      if (seq !== this.requestSeq) return
      this.applyMe(me)
      wx.showToast({ title: '申请已提交，等待审核', icon: 'none' })
    } catch (err) {
      if (seq === this.requestSeq) showError(err)
    } finally {
      if (seq === this.requestSeq) this.setData({ submitting: false })
    }
  },

  onViewCard() {
    if (this.data.me?.membership.state === 'active') wx.navigateTo({ url: CARD_URL })
  },
})
