export interface HandbookSection {
  id: number
  title: string
  content: string
}

export interface SupportContent {
  handbook: HandbookSection[]
  website_url: string | null
  assistant_wechat: string | null
}

export type FeedbackCategory = 'suggestion' | 'bug' | 'merchant'

export interface FeedbackBody {
  category: FeedbackCategory
  content: string
  contact?: string
}

export interface FeedbackResult {
  id: number
}

export const FEEDBACK_MIN_LENGTH = 10
export const FEEDBACK_MAX_LENGTH = 1000
export const FEEDBACK_CONTACT_MAX_LENGTH = 100
