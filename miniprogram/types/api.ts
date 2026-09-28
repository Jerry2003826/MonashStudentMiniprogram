// 前后端的接口约定，和 docs/tech-design.md 第 5.3 节保持一致。

export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'MEMBERSHIP_REQUIRED',
  'USER_BANNED',
  'NOT_FOUND',
  'ALREADY_MEMBER',
  'RENEWAL_NOT_OPEN',
  'MEMBERSHIP_REVOKED',
  'VALIDATION_ERROR',
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'CODE_INVALID',
  'CONTENT_RISKY',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ErrorBody {
  code: ApiErrorCode
  message: string
}

export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}

// 会员

export type MembershipState = 'none' | 'active' | 'expired' | 'revoked'

export type StaffRole = 'owner' | 'reviewer' | 'editor'

export interface MembershipApplication {
  id: number
  email: string
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string
  reviewed_at: string | null
  review_note: string
}

export interface MembershipInfo {
  state: MembershipState
  member_no: string | null
  email: string | null
  expires_at: string | null
  renewable: boolean
  application: MembershipApplication | null
}

export interface Me {
  id: number
  nickname: string
  avatar_url: string | null
  banned_until: string | null
  staff_role: StaffRole | null
  membership: MembershipInfo
}

export interface LoginResult {
  token: string
  me: Me
}

export interface UpdateMeBody {
  nickname: string
}

export interface EmailCodeBody {
  email: string
}

export interface VerifyEmailBody {
  email: string
  code: string
}

// 首页和商家

export type BannerLinkType = 'none' | 'merchant' | 'post'

export interface Banner {
  id: number
  title: string
  image_url: string
  link_type: BannerLinkType
  link_id: number | null
}

export interface Category {
  id: number
  name: string
}

export interface Area {
  id: number
  name: string
}

export interface MerchantFilters {
  categories: Category[]
  areas: Area[]
}

export interface MerchantSummary {
  id: number
  name: string
  logo_url: string
  category: Category
  area: Area
  discount_summary: string
  is_example?: boolean
}

export interface MerchantDetail extends MerchantSummary {
  intro: string
  discount_terms: string
  image_urls: string[]
  address: string
  latitude: number
  longitude: number
  phone: string
  opening_hours: string
}

export interface MerchantQuery {
  category?: number
  area?: number
  q?: string
  cursor?: string
}

export interface HomeData {
  banners: Banner[]
  featured_merchants: MerchantSummary[]
}

// 论坛

export interface Author {
  id: number
  nickname: string
  avatar_url: string | null
}

export interface Board {
  id: number
  name: string
  intro: string
  staff_only: boolean
}

export type ImageCheckStatus = 'pending' | 'pass' | 'risky'

export interface PostImage {
  id: number
  url: string
  check_status: ImageCheckStatus
}

export type ModerationStatus = 'pending' | 'approved' | 'rejected'

export interface ModeratedContent {
  moderation_status: ModerationStatus
  review_note: string
}

export interface PostSummary extends ModeratedContent {
  id: number
  board: Board
  title: string
  excerpt: string
  thumbnail_urls: string[]
  author: Author
  like_count: number
  comment_count: number
  is_pinned: boolean
  created_at: string
}

export interface PostDetail extends ModeratedContent {
  id: number
  board: Board
  title: string
  content: string
  images: PostImage[]
  author: Author
  like_count: number
  comment_count: number
  liked: boolean
  is_pinned: boolean
  is_mine: boolean
  created_at: string
}

export interface PostQuery {
  board?: number
  q?: string
  author?: 'me'
  cursor?: string
}

export interface Comment extends ModeratedContent {
  id: number
  author: Author
  reply_to: Author | null
  content: string
  created_at: string
  is_mine: boolean
}

export interface CreatePostBody {
  board_id: number
  title: string
  content: string
  image_ids: number[]
}

export interface CreateCommentBody {
  content: string
  reply_to_user_id?: number
}

export interface LikeResult {
  liked: boolean
  like_count: number
}

export type ReportReason = 'ad' | 'porn' | 'abuse' | 'illegal' | 'other'

export type ReportTargetType = 'post' | 'comment'

export interface CreateReportBody {
  target_type: ReportTargetType
  target_id: number
  reason: ReportReason
  detail?: string
}
