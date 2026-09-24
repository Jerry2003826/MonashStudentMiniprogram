import { getEnvVersion } from '../../config'

const ENV_LABELS = { develop: '开发版', trial: '体验版', release: '正式版' } as const

Page({
  data: {
    version: '',
  },

  onLoad() {
    const { version } = wx.getAccountInfoSync().miniProgram
    this.setData({ version: version || ENV_LABELS[getEnvVersion()] })
  },
})
