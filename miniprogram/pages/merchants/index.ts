import {
  getMerchantFilters,
  listMerchantMapPins,
  listMerchants,
} from '../../services/api/merchants'
import { fetchMe, getCachedMe } from '../../services/auth'
import { showError } from '../../services/errors'
import type {
  Coordinates,
  LocatedMerchantSummary,
  MerchantMapPin,
} from '../../types/merchant-location'
import {
  formatStraightLineDistance,
  isValidCoordinates,
  straightLineDistance,
} from '../../utils/distance'
import { memberEntry } from '../../utils/membership'
import { syncTabBar } from '../../utils/tab-bar'

interface FilterOption {
  label: string
  value: number
}

const ALL = 0
const DEFAULT_MAP_CENTRE: Coordinates = { latitude: -37.9105, longitude: 145.134 }

// 包围盒中心，避免地图停在第一家商家附近、其他区域的商家落在画面外
function centreOf(points: Coordinates[]): Coordinates | null {
  if (!points.length) return null
  const latitudes = points.map((point) => point.latitude)
  const longitudes = points.map((point) => point.longitude)
  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  }
}

interface SelectedPin extends MerchantMapPin {
  distanceText: string
}

function merchantMarkers(pins: MerchantMapPin[]) {
  return pins.filter(isValidCoordinates).map((merchant) => ({
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
    pins: [] as MerchantMapPin[],
    pinsLoading: false,
    pinsFailed: false,
    selectedPin: null as SelectedPin | null,
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
  pinSeq: 0,
  // 筛选条件变了但地图还没展开时，等展开再加载点位
  pinsStale: true,

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
    this.pinSeq += 1
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
    this.pinsStale = true
    if (this.data.mapVisible) this.loadPins()
    this.setData({
      items: [],
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
      this.setData({
        items: [...this.data.items, ...page.items],
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

  async loadPins() {
    this.pinSeq += 1
    const seq = this.pinSeq
    this.pinsStale = false
    this.setData({ pinsLoading: true, pinsFailed: false, selectedPin: null })
    try {
      const { keyword, category, area } = this.data
      const { items } = await listMerchantMapPins({
        q: keyword || undefined,
        category: category || undefined,
        area: area || undefined,
      })
      if (seq !== this.pinSeq) return
      const markers = merchantMarkers(items)
      const mapPoints = markers.map(({ latitude, longitude }) => ({ latitude, longitude }))
      this.setData(
        {
          pins: items,
          markers,
          mapPoints,
          mapCentre: centreOf(mapPoints) ?? this.data.location ?? DEFAULT_MAP_CENTRE,
        },
        () => this.fitMapToPins(),
      )
    } catch (err) {
      if (seq !== this.pinSeq) return
      this.pinsStale = true
      this.setData({ pinsFailed: true })
      showError(err)
    } finally {
      if (seq === this.pinSeq) this.setData({ pinsLoading: false })
    }
  },

  // 模板里的 include-points 在地图刚创建时经常不生效，渲染后再主动缩放一次
  fitMapToPins() {
    const points = this.data.mapPoints
    if (!this.data.mapVisible || points.length === 0) return
    if (points.length === 1) {
      this.setData({ mapCentre: points[0] })
      return
    }
    wx.createMapContext('merchant-map', this).includePoints({
      points,
      padding: [48, 48, 48, 48],
    })
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
    const mapVisible = !this.data.mapVisible
    this.setData({ mapVisible, selectedPin: null }, () => {
      // 地图用 wx:if 渲染，每次展开都是新建的，需要重新缩放
      if (mapVisible && !this.pinsStale) this.fitMapToPins()
    })
    if (mapVisible && this.pinsStale) this.loadPins()
  },

  onMarkerTap(e: WechatMiniprogram.CustomEvent<{ markerId: number }>) {
    const pin = this.data.pins.find((item) => item.id === Number(e.detail.markerId))
    if (!pin) return
    const { location } = this.data
    const distanceText = location
      ? formatStraightLineDistance(straightLineDistance(location, pin))
      : ''
    this.setData({ selectedPin: { ...pin, distanceText } })
  },

  onOpenSelectedPin() {
    const pin = this.data.selectedPin
    if (pin) wx.navigateTo({ url: `/pages/merchant-detail/index?id=${pin.id}` })
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
