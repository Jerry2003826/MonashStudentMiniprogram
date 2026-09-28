import { getDevelopmentLoginUsername, isMockEnabled } from '../../config'
import { submitFeedback } from '../../services/api/support'
import { ensureLogin } from '../../services/auth'
import { showError } from '../../services/errors'
import {
  FEEDBACK_CONTACT_MAX_LENGTH,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  type FeedbackCategory,
} from '../../types/support'

Page({
  data: {
    categories: [
      { value: 'suggestion', label: '功能建议' },
      { value: 'bug', label: '使用问题' },
      { value: 'merchant', label: '商家信息' },
    ],
    category: 'suggestion' as FeedbackCategory,
    content: '',
    contact: '',
    contentMin: FEEDBACK_MIN_LENGTH,
    contentMax: FEEDBACK_MAX_LENGTH,
    contactMax: FEEDBACK_CONTACT_MAX_LENGTH,
    canSubmit: false,
    submitting: false,
    isDemo: false,
    isLocalTest: false,
    receiptId: 0,
  },

  onLoad() {
    this.setData({ isDemo: isMockEnabled(), isLocalTest: getDevelopmentLoginUsername() !== null })
  },

  onCategoryChange(e: WechatMiniprogram.CustomEvent) {
    if (this.data.submitting) return
    const category = this.data.categories.find(
      (item) => item.value === e.currentTarget.dataset.value,
    )
    if (category) this.setData({ category: category.value as FeedbackCategory })
  },

  onContentInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.submitting) return
    const content = e.detail.value
    const length = content.trim().length
    this.setData({
      content,
      canSubmit: length >= FEEDBACK_MIN_LENGTH && length <= FEEDBACK_MAX_LENGTH,
    })
  },

  onContactInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.submitting) this.setData({ contact: e.detail.value })
  },

  async onSubmit() {
    if (this.data.submitting || this.data.receiptId) return
    const content = this.data.content.trim()
    const contact = this.data.contact.trim()
    if (content.length < FEEDBACK_MIN_LENGTH || content.length > FEEDBACK_MAX_LENGTH) {
      wx.showToast({
        title: `请填写 ${FEEDBACK_MIN_LENGTH}–${FEEDBACK_MAX_LENGTH} 字的反馈`,
        icon: 'none',
      })
      return
    }
    if (contact.length > FEEDBACK_CONTACT_MAX_LENGTH) {
      wx.showToast({ title: `联系方式不能超过 ${FEEDBACK_CONTACT_MAX_LENGTH} 字`, icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await ensureLogin()
      const receipt = await submitFeedback({ category: this.data.category, content, contact })
      this.setData({ receiptId: receipt.id, content: '', contact: '', canSubmit: false })
    } catch (err) {
      showError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  onWriteAgain() {
    this.setData({ receiptId: 0 })
  },
})
