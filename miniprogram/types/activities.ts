export type ActivityCategory = 'latest' | 'news' | 'past'

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  latest: '最新活动',
  news: '资讯信息',
  past: '往期回顾',
}

export interface ActivitySummary {
  id: number
  title: string
  summary: string
  category: ActivityCategory
  starts_at: string | null
  location: string
  is_example: boolean
}

export interface ActivityDetail extends ActivitySummary {
  content: string
  article_url: string | null
}

export interface ActivityQuery {
  category?: ActivityCategory
  q?: string
  cursor?: string
}
