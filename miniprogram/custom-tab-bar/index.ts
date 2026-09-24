import { TABS, type TabValue } from '../utils/tab-bar'

Component({
  data: {
    value: 'home' as TabValue,
    tabs: TABS,
  },
  methods: {
    onChange(e: WechatMiniprogram.CustomEvent<{ value: TabValue }>) {
      const tab = TABS.find((item) => item.value === e.detail.value)
      if (tab) wx.switchTab({ url: tab.path })
    },
  },
})
