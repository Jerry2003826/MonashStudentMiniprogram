import { getMerchant } from '../../services/api/merchants'
import { fetchMe, isActiveMember } from '../../services/auth'
import { defaultMessage, isApiError, showError } from '../../services/errors'
import type { MerchantDetail } from '../../types/api'
import { CARD_URL, VERIFY_URL } from '../../utils/membership'

function actionTextOf(isMember: boolean): string {
  return isMember ? '出示会员卡' : '申请会员，审核后可用'
}

Page({
  data: {
    merchant: null as MerchantDetail | null,
    errorMessage: '',
    isMember: false,
    actionText: actionTextOf(false),
    testingLabel: '',
  },

  async onLoad(query: Record<string, string | undefined>) {
    this.setData({ testingLabel: getTestingLabel() })
    try {
      const merchant = await getMerchant(Number(query.id))
      this.setData({ merchant })
      wx.setNavigationBarTitle({ title: merchant.name })
    } catch (err) {
      const errorMessage = isApiError(err) ? err.message : defaultMessage('INTERNAL_ERROR')
      this.setData({ errorMessage })
      showError(err)
    }
  },

  async onShow() {
    try {
      const isMember = isActiveMember(await fetchMe())
      this.setData({ isMember, actionText: actionTextOf(isMember) })
    } catch (err) {
      showError(err)
    }
  },

  onPreviewImage(e: WechatMiniprogram.TouchEvent) {
    const urls = this.data.merchant?.image_urls ?? []
    wx.previewImage({ urls, current: urls[Number(e.currentTarget.dataset.index)] })
  },

  onCall() {
    const phone = this.data.merchant?.phone
    if (phone) wx.makePhoneCall({ phoneNumber: phone.replace(/\s/g, '') })
  },

  onOpenMap() {
    const merchant = this.data.merchant
    if (!merchant) return
    wx.openLocation({
      latitude: merchant.latitude,
      longitude: merchant.longitude,
      name: merchant.name,
      address: merchant.address,
      scale: 16,
    })
  },

  onCopyAddress() {
    const address = this.data.merchant?.address
    if (!address) return
    wx.setClipboardData({
      data: address,
      fail: () => wx.showToast({ title: '复制失败，请手动记下地址', icon: 'none' }),
    })
  },

  onShowCard() {
    wx.navigateTo({ url: this.data.isMember ? CARD_URL : VERIFY_URL })
  },
})
import { getTestingLabel } from '../../deployment'
