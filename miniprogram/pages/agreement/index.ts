import { AGREEMENTS, isAgreementType } from './content'

Page({
  data: {
    agreement: AGREEMENTS.terms,
  },

  onLoad(query: Record<string, string | undefined>) {
    const agreement = AGREEMENTS[isAgreementType(query.type) ? query.type : 'terms']
    this.setData({ agreement })
    wx.setNavigationBarTitle({ title: agreement.title })
  },
})
