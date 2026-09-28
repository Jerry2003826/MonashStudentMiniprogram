import { listActivities } from '../../services/api/activities'
import { defaultMessage, isApiError } from '../../services/errors'
import {
  ACTIVITY_CATEGORY_LABELS,
  type ActivityCategory,
  type ActivitySummary,
} from '../../types/activities'
import { syncTabBar } from '../../utils/tab-bar'

type ActivityView = ActivitySummary & { dateText: string }

function toView(activity: ActivitySummary): ActivityView {
  return {
    ...activity,
    dateText: activity.starts_at ? activity.starts_at.slice(0, 10) : '时间待公布',
  }
}

Page({
  data: {
    category: 'latest' as ActivityCategory,
    categories: [
      { value: 'latest', label: ACTIVITY_CATEGORY_LABELS.latest },
      { value: 'news', label: ACTIVITY_CATEGORY_LABELS.news },
      { value: 'past', label: ACTIVITY_CATEGORY_LABELS.past },
    ],
    keyword: '',
    items: [] as ActivityView[],
    featured: [] as ActivityView[],
    cursor: null as string | null,
    hasMore: true,
    loading: false,
    loaded: false,
    errorMessage: '',
    hasExamples: false,
  },

  requestSeq: 0,

  onLoad() {
    this.refresh()
  },

  onShow() {
    syncTabBar(this, 'activities')
  },

  onUnload() {
    this.requestSeq += 1
  },

  async onPullDownRefresh() {
    await this.refresh()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore && !this.data.errorMessage) this.fetchPage()
  },

  async refresh() {
    this.setData({
      items: [],
      featured: [],
      cursor: null,
      hasMore: true,
      loaded: false,
      errorMessage: '',
      hasExamples: false,
    })
    await this.fetchPage()
  },

  async fetchPage() {
    const seq = ++this.requestSeq
    const { category, keyword, cursor } = this.data
    this.setData({ loading: true, errorMessage: '' })
    try {
      const page = await listActivities({
        category,
        q: keyword || undefined,
        cursor: cursor ?? undefined,
      })
      if (seq !== this.requestSeq) return
      const items = [...this.data.items, ...page.items.map(toView)]
      this.setData({
        items,
        featured: items.slice(0, 3),
        cursor: page.next_cursor,
        hasMore: page.next_cursor !== null,
        loaded: true,
        hasExamples: items.some((activity) => activity.is_example),
      })
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

  onCategoryChange(e: WechatMiniprogram.CustomEvent<{ value: ActivityCategory }>) {
    if (!this.data.categories.some((category) => category.value === e.detail.value)) return
    this.setData({ category: e.detail.value })
    this.refresh()
  },

  onSearch(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keyword: e.detail.value.trim() })
    this.refresh()
  },

  onClearSearch() {
    this.setData({ keyword: '' })
    this.refresh()
  },

  onRetry() {
    if (!this.data.loading) this.fetchPage()
  },

  onActivityTap(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (Number.isInteger(id) && id > 0)
      wx.navigateTo({ url: `/pages/activity-detail/index?id=${id}` })
  },

  onShareAppMessage() {
    return { title: '蒙纳士中国学生会 · 活动与资讯', path: '/pages/activities/index' }
  },
})
