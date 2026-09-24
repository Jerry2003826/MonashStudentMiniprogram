import { getMerchantFilters, listMerchants } from '../../services/api/merchants'
import { ensureLogin } from '../../services/auth'
import { showError } from '../../services/errors'
import type { MerchantSummary } from '../../types/api'
import { syncTabBar } from '../../utils/tab-bar'

interface FilterOption {
  label: string
  value: number
}

const ALL = 0

Page({
  data: {
    keyword: '',
    category: ALL,
    area: ALL,
    categoryOptions: [{ label: '全部分类', value: ALL }] as FilterOption[],
    areaOptions: [{ label: '全部区域', value: ALL }] as FilterOption[],
    items: [] as MerchantSummary[],
    cursor: null as string | null,
    hasMore: true,
    loading: false,
    loaded: false,
  },

  // 筛选条件切换太快时，只保留最后一次请求的结果
  requestSeq: 0,

  async onLoad() {
    try {
      await ensureLogin()
      const filters = await getMerchantFilters()
      this.setData({
        categoryOptions: [
          { label: '全部分类', value: ALL },
          ...filters.categories.map((item) => ({ label: item.name, value: item.id })),
        ],
        areaOptions: [
          { label: '全部区域', value: ALL },
          ...filters.areas.map((item) => ({ label: item.name, value: item.id })),
        ],
      })
    } catch (err) {
      showError(err)
    }
    await this.refresh()
  },

  onShow() {
    syncTabBar(this, 'merchants')
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
      const { keyword, category, area, cursor } = this.data
      const page = await listMerchants({
        q: keyword || undefined,
        category: category || undefined,
        area: area || undefined,
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

  onSearch(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keyword: e.detail.value.trim() })
    this.refresh()
  },

  onClearSearch() {
    this.setData({ keyword: '' })
    this.refresh()
  },

  onCategoryChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setData({ category: e.detail.value })
    this.refresh()
  },

  onAreaChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setData({ area: e.detail.value })
    this.refresh()
  },
})
