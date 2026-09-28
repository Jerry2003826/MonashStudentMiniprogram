import { isMockEnabled } from '../../config'
import { getPublicDeployment, getTestingLabel } from '../../deployment'
import { getAgreement, isAgreementType } from './content'
import type { Agreement } from './content'

Page({
  data: {
    agreement: { title: '', sections: [] } as Agreement,
    notice: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const demo = isMockEnabled()
    const testing = Boolean(getTestingLabel())
    const agreement = getAgreement(isAgreementType(query.type) ? query.type : 'terms', {
      demo,
      testing,
      disclosure: getPublicDeployment()?.disclosure ?? null,
    })
    this.setData({
      agreement,
      notice: demo ? '功能演示说明' : testing ? '内测版 · 请先阅读使用范围与信息处理说明' : '',
    })
    wx.setNavigationBarTitle({ title: agreement.title })
  },
})
