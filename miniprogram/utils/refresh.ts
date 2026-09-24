// 发帖、删帖后标记相关列表需要刷新，列表页在 onShow 里检查，避免每次切回来都重新加载、丢掉滚动位置

export type RefreshKey = 'forum' | 'my-posts'

const dirty = new Set<RefreshKey>()

export function markDirty(...keys: RefreshKey[]): void {
  keys.forEach((key) => dirty.add(key))
}

export function consumeDirty(key: RefreshKey): boolean {
  const wasDirty = dirty.has(key)
  dirty.delete(key)
  return wasDirty
}
