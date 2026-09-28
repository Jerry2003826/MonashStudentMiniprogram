import { getEnvVersion } from '../../config'
import { getPublicDeployment, getTestingLabel } from '../../deployment'
import { getSupportContent } from '../../services/api/support'
import { showError } from '../../services/errors'

const ENV_LABELS = { develop: '开发版', trial: '体验版', release: '正式版' } as const

Page({
  data: {
    version: '',
    websiteUrl: '',
    supportError: false,
    testingLabel: '',
  },

  onLoad() {
    const { version } = wx.getAccountInfoSync().miniProgram
    this.setData({
      version: getPublicDeployment()?.version || version || ENV_LABELS[getEnvVersion()],
      testingLabel: getTestingLabel(),
    })
    this.loadWebsite()
  },

  async loadWebsite() {
    try {
      const content = await getSupportContent()
      this.setData({ websiteUrl: content.website_url ?? '', supportError: false })
    } catch {
      this.setData({ supportError: true })
    }
  },

  onWebsite() {
    if (this.data.supportError) {
      this.loadWebsite()
      return
    }
    if (!this.data.websiteUrl) {
      wx.showToast({ title: '官网地址待学联确认', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: this.data.websiteUrl, fail: showError })
  },
})
