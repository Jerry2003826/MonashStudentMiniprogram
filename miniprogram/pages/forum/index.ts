import { syncTabBar } from '../../utils/tab-bar'

Page({
  onShow() {
    syncTabBar(this, 'forum')
  },
})
