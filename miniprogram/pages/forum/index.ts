import { listBoards, listPosts } from '../../services/api/forum'
import { ensureLogin } from '../../services/auth'
import { showError } from '../../services/errors'
import type { Board, PostSummary } from '../../types/api'
import { ensureMember } from '../../utils/guard'
import { consumeDirty } from '../../utils/refresh'
import { syncTabBar } from '../../utils/tab-bar'

const ALL = 0

Page({
  data: {
    boards: [] as Board[],
    board: ALL,
    keyword: '',
    items: [] as PostSummary[],
    cursor: null as string | null,
    hasMore: true,
    loading: false,
    loaded: false,
  },

  // 切换板块太快时，只保留最后一次请求的结果
  requestSeq: 0,

  async onLoad() {
    try {
      await ensureLogin()
      this.setData({ boards: await listBoards() })
    } catch (err) {
      showError(err)
    }
    await this.refresh()
  },

  onShow() {
    syncTabBar(this, 'forum')
    if (consumeDirty('forum')) this.refresh()
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
    this.requestSeq += 1
    const seq = this.requestSeq
    this.setData({ loading: true })
    try {
      await ensureLogin()
      const { board, keyword, cursor } = this.data
      const page = await listPosts({
        board: board || undefined,
        q: keyword || undefined,
        cursor: cursor ?? undefined,
      })
      if (seq !== this.requestSeq) return
      this.setData({
        items: [...this.data.items, ...page.items],
        cursor: page.next_cursor,
        hasMore: page.next_cursor !== null,
        loaded: true,
      })
    } catch (err) {
      if (seq === this.requestSeq) showError(err)
    } finally {
      if (seq === this.requestSeq) this.setData({ loading: false })
    }
  },

  onTabChange(e: WechatMiniprogram.CustomEvent<{ value: number | string }>) {
    this.setData({ board: Number(e.detail.value) })
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

  async onCreatePost() {
    try {
      if (await ensureMember('发帖')) wx.navigateTo({ url: '/pages/post-create/index' })
    } catch (err) {
      showError(err)
    }
  },
})
