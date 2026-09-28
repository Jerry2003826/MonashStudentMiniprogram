import type { MerchantSummary } from '../../types/api'
import type { LocatedMerchantSummary } from '../../types/merchant-location'
import { formatStraightLineDistance } from '../../utils/distance'

Component({
  properties: {
    merchant: { type: Object, value: {} },
    showDistance: { type: Boolean, value: false },
  },
  data: {
    distanceText: '',
  },
  observers: {
    merchant(merchant: Partial<LocatedMerchantSummary>) {
      this.setData({ distanceText: formatStraightLineDistance(merchant.distance_m) })
    },
  },
  methods: {
    onTap() {
      const merchant = this.data.merchant as MerchantSummary
      wx.navigateTo({ url: `/pages/merchant-detail/index?id=${merchant.id}` })
    },
  },
})
