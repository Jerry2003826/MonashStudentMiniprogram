import { getActivity } from '../../services/api/activities'
import { defaultMessage, isApiError } from '../../services/errors'
import { ACTIVITY_CATEGORY_LABELS, type ActivityDetail } from '../../types/activities'

Page({
  data: {
    activity: null as ActivityDetail | null,
    categoryLabel: '',
    dateText: '',
    loading: false,
    errorMessage: '',
  },

  activityId: 0,
  requestSeq: 0,

  onLoad(query: Record<string, string | undefined>) {
    this.activityId = Number(query.id)
    this.load()
  },

  onUnload() {
    this.requestSeq += 1
  },

  async load() {
    if (!Number.isInteger(this.activityId) || this.activityId <= 0) {
      this.setData({ errorMessage: '活动链接无效，请返回活动页重新选择。', loading: false })
      return
    }
    const seq = ++this.requestSeq
    this.setData({ loading: true, errorMessage: '' })
    try {
      const activity = await getActivity(this.activityId)
      if (seq !== this.requestSeq) return
      this.setData({
        activity,
        categoryLabel: ACTIVITY_CATEGORY_LABELS[activity.category],
        dateText: activity.starts_at ? activity.starts_at.slice(0, 10) : '时间待官方公布',
      })
      wx.setNavigationBarTitle({ title: activity.title })
    } catch (err) {
      if (seq === this.requestSeq) {
        this.setData({
          errorMessage: isApiError(err) ? err.message : defaultMessage('NETWORK_ERROR'),
        })
      }
    } finally {
      if (seq === this.requestSeq) this.setData({ loading: false })
    }
  },

  onRetry() {
    if (!this.data.loading) this.load()
  },

  onBackToActivities() {
    wx.switchTab({ url: '/pages/activities/index' })
  },

  onOpenArticle() {
    const url = this.data.activity?.article_url
    if (!url) return
    if (!/^https:\/\/mp\.weixin\.qq\.com\/s(?:[/?]|$)/i.test(url)) {
      wx.showToast({ title: '公众号原文链接无效，请联系学生会更新', icon: 'none' })
      return
    }
    if (wx.canIUse('openOfficialAccountArticle')) {
      wx.openOfficialAccountArticle({ url, fail: () => this.offerCopyArticle(url) })
    } else {
      this.offerCopyArticle(url)
    }
  },

  offerCopyArticle(url: string) {
    wx.showModal({
      title: '暂时无法打开公众号原文',
      content: '可以复制文章链接后在微信中打开，也可以更新微信后重试。',
      confirmText: '复制链接',
      success: ({ confirm }) => {
        if (!confirm) return
        wx.setClipboardData({
          data: url,
          fail: () => wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' }),
        })
      },
    })
  },

  onShareAppMessage() {
    const activity = this.data.activity
    return activity
      ? {
          title: `${activity.is_example ? '【示例】' : ''}${activity.title}`,
          path: `/pages/activity-detail/index?id=${activity.id}`,
        }
      : { title: '蒙纳士中国学生会 · 活动与资讯', path: '/pages/activities/index' }
  },
})
