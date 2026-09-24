export type TabValue = 'home' | 'merchants' | 'forum' | 'profile'

export interface TabItem {
  value: TabValue
  label: string
  icon: string
  path: string
}

export const TABS: TabItem[] = [
  { value: 'home', label: '首页', icon: 'home', path: '/pages/home/index' },
  { value: 'merchants', label: '商家', icon: 'shop', path: '/pages/merchants/index' },
  { value: 'forum', label: '论坛', icon: 'chat', path: '/pages/forum/index' },
  { value: 'profile', label: '我的', icon: 'user', path: '/pages/profile/index' },
]

interface PageWithTabBar {
  getTabBar(): WechatMiniprogram.Component.TrivialInstance | undefined
}

// 自定义标签栏在每个标签页里各有一个实例，切换页面后要各自同步选中项
export function syncTabBar(page: PageWithTabBar, value: TabValue): void {
  const tabBar = typeof page.getTabBar === 'function' ? page.getTabBar() : undefined
  tabBar?.setData({ value })
}
