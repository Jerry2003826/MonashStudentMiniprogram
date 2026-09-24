const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDate(iso: string): string {
  return dateOf(new Date(iso))
}

export function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const time = new Date(iso)
  const diff = now.getTime() - time.getTime()
  if (diff < MINUTE_MS) return '刚刚'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分钟前`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} 小时前`
  if (diff < 2 * DAY_MS) return '昨天'
  if (time.getFullYear() === now.getFullYear()) return `${time.getMonth() + 1}月${time.getDate()}日`
  return dateOf(time)
}
