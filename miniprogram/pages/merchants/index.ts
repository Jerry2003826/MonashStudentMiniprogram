import { getMerchantFilters, listMerchants } from '../../services/api/merchants'
import { fetchMe, getCachedMe } from '../../services/auth'
import { showError } from '../../services/errors'
import type { Coordinates, LocatedMerchantSummary } from '../../types/merchant-location'
import { isValidCoordinates } from '../../utils/distance'
import { memberEntry } from '../../utils/membership'
import { syncTabBar } from '../../utils/tab-bar'

interface FilterOption {
  label: string
  value: number
}

const ALL = 0
const DEFAULT_MAP_CENTRE: Coordinates = { latitude: -37.9105, longitude: 145.134 }

function merchantMarkers(items: LocatedMerchantSummary[]) {
  return items.filter(isValidCoordinates).map((merchant) => ({
    id: merchant.id,
    latitude: merchant.latitude,
    longitude: merchant.longitude,
    title: merchant.name,
    iconPath: '/pages/merchants/marker.png',
    width: 28,
    height: 36,
    callout: { content: merchant.name, display: 'BYCLICK', padding: 8, borderRadius: 6 },
  }))
}

Page({
  data: {
    keyword: '',
    category: ALL,
    area: ALL,
    categoryOptions: [{ label: '全部分类', value: ALL }] as FilterOption[],
    areaOptions: [{ label: '全部区域', value: ALL }] as FilterOption[],
    items: [] as LocatedMerchantSummary[],
    cursor: null as string | null,
    hasMore: true,
    loading: false,
    loaded: false,
    entry: memberEntry(null),
    mapVisible: false,
    mapCentre: DEFAULT_MAP_CENTRE,
    markers: merchantMarkers([]),
    mapPoints: [] as Coordinates[],
    nearby: false,
    location: null as Coordinates | null,
    locating: false,
    locationMessage: '',
    showPrivacy: false,
    privacyContractName: '《用户隐私保护指引》',
    loadFailed: false,
  },

  // 筛选条件切换太快时，只保留最后一次请求的结果
  requestSeq: 0,
  locationSeq: 0,

  async onLoad() {
    try {
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
    this.setData({ entry: memberEntry(getCachedMe()) })
    this.loadMemberEntry()
  },

  onHide() {
    // 离开页面后丢弃尚未返回的定位；再次进入时不自动申请定位。
    this.locationSeq += 1
    this.setData({ locating: false })
  },

  onUnload() {
    this.locationSeq += 1
    this.requestSeq += 1
  },

  async loadMemberEntry() {
    try {
      this.setData({ entry: memberEntry(await fetchMe()) })
    } catch {
      // 会员状态加载失败不阻塞公开商家列表，保留缓存中的入口。
    }
  },

  onEntryTap() {
    wx.navigateTo({ url: this.data.entry.url })
  },

  async onPullDownRefresh() {
    await this.refresh()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    this.loadMore()
  },

  async refresh() {
    this.setData({
      items: [],
      markers: [],
      mapPoints: [],
      cursor: null,
      hasMore: true,
      loaded: false,
      loadFailed: false,
    })
    await this.fetchPage()
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    await this.fetchPage()
  },

  async fetchPage() {
    this.requestSeq += 1
    const seq = this.requestSeq
    this.setData({ loading: true, loadFailed: false })
    try {
      const { keyword, category, area, cursor, location } = this.data
      const page = await listMerchants({
        q: keyword || undefined,
        category: category || undefined,
        area: area || undefined,
        cursor: cursor ?? undefined,
        latitude: location?.latitude,
        longitude: location?.longitude,
        sort: location ? 'distance' : undefined,
      })
      if (seq !== this.requestSeq) return
      const items = [...this.data.items, ...page.items]
      const markers = merchantMarkers(items)
      const mapPoints = markers.map(({ latitude, longitude }) => ({ latitude, longitude }))
      this.setData({
        items,
        markers,
        mapPoints,
        mapCentre: mapPoints[0] ?? location ?? DEFAULT_MAP_CENTRE,
        cursor: page.next_cursor,
        hasMore: page.next_cursor !== null,
        loaded: true,
      })
    } catch (err) {
      if (seq === this.requestSeq) {
        this.setData({ loadFailed: true })
        showError(err)
      }
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

  onToggleMap() {
    this.setData({ mapVisible: !this.data.mapVisible })
  },

  onMarkerTap(e: WechatMiniprogram.CustomEvent<{ markerId: number }>) {
    const id = Number(e.detail.markerId)
    if (this.data.items.some((merchant) => merchant.id === id)) {
      wx.navigateTo({ url: `/pages/merchant-detail/index?id=${id}` })
    }
  },

  onNearbyTap() {
    if (this.data.locating) return
    if (this.data.nearby) {
      this.locationSeq += 1
      this.setData({ nearby: false, location: null, locationMessage: '' })
      this.refresh()
      return
    }
    this.locationSeq += 1
    const seq = this.locationSeq
    this.setData({ locating: true, locationMessage: '' })
    if (typeof wx.getPrivacySetting !== 'function') {
      this.requestLocation()
      return
    }
    wx.getPrivacySetting({
      success: (result) => {
        if (seq !== this.locationSeq) return
        if (result.needAuthorization) {
          this.setData({
            showPrivacy: true,
            locating: false,
            privacyContractName: result.privacyContractName || '《用户隐私保护指引》',
          })
        } else {
          this.requestLocation()
        }
      },
      fail: () => {
        if (seq !== this.locationSeq) return
        this.setData({
          locating: false,
          locationMessage: '暂时无法确认位置授权。你仍可搜索或按区域浏览商家。',
        })
      },
    })
  },

  onOpenPrivacyContract() {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' }),
    })
  },

  onAgreePrivacy() {
    if (!this.data.showPrivacy) return
    this.setData({ showPrivacy: false })
    this.requestLocation()
  },

  onCancelPrivacy() {
    this.locationSeq += 1
    this.setData({
      showPrivacy: false,
      locating: false,
      locationMessage: '未开启定位。你仍可搜索或按区域浏览商家。',
    })
  },

  requestLocation() {
    this.locationSeq += 1
    const seq = this.locationSeq
    this.setData({ locating: true, locationMessage: '' })
    wx.getLocation({
      type: 'gcj02',
      success: ({ latitude, longitude }) => {
        if (seq !== this.locationSeq) return
        const location = { latitude, longitude }
        if (!isValidCoordinates(location)) {
          this.setData({ locating: false, locationMessage: '未能获取有效位置，请稍后重试。' })
          return
        }
        // 位置仅用于本次浏览；不写入缓存，不持续跟踪。
        this.setData({ nearby: true, location, locating: false })
        this.refresh()
      },
      fail: () => {
        if (seq !== this.locationSeq) return
        this.setData({
          locating: false,
          locationMessage: '未取得位置，请检查微信定位权限后重试。你仍可搜索或按区域浏览。',
        })
      },
    })
  },
})
