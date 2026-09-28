import { listPosts } from '../../services/api/forum'
import { ensureLogin } from '../../services/auth'
import { showError } from '../../services/errors'
import type { PostSummary } from '../../types/api'
import { ensureMember } from '../../utils/guard'
import { consumeDirty } from '../../utils/refresh'

Page({
  data: {
    items: [] as PostSummary[],
    cursor: null as string | null,
    hasMore: true,
    loading: false,
    loaded: false,
    loadFailed: false,
  },

  onLoad() {
    consumeDirty('my-posts')
    this.refresh()
  },

  onShow() {
    if (consumeDirty('my-posts')) this.refresh()
  },

  async onPullDownRefresh() {
    await this.refresh()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    this.loadMore()
  },

  async refresh() {
    this.setData({ items: [], cursor: null, hasMore: true, loaded: false })
    await this.fetchPage()
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    await this.fetchPage()
  },

  async fetchPage() {
    this.setData({ loading: true, loadFailed: false })
    try {
      await ensureLogin()
      const page = await listPosts({ author: 'me', cursor: this.data.cursor ?? undefined })
      this.setData({
        items: [...this.data.items, ...page.items],
        cursor: page.next_cursor,
        hasMore: page.next_cursor !== null,
        loaded: true,
      })
    } catch (err) {
      this.setData({ loadFailed: true })
      showError(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async onCreatePost() {
    try {
      if (await ensureMember('发帖')) wx.navigateTo({ url: '/pages/post-create/index' })
    } catch (err) {
      showError(err)
    }
  },
})
