import type { MerchantSummary } from '../../types/api'

Component({
  properties: {
    merchant: { type: Object, value: {} },
  },
  methods: {
    onTap() {
      const merchant = this.data.merchant as MerchantSummary
      wx.navigateTo({ url: `/pages/merchant-detail/index?id=${merchant.id}` })
    },
  },
})
