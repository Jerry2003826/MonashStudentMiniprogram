import type {
  Area,
  Banner,
  Board,
  Category,
  CreateReportBody,
  ImageCheckStatus,
  MembershipApplication,
  ModeratedContent,
  StaffRole,
} from '../../types/api'
import { createSeed } from './seed'

export interface MockUser {
  id: number
  nickname: string
  avatar_url: string | null
  banned_until: string | null
  staff_role: StaffRole | null
}

export interface MockMembership {
  email: string
  member_no: string
  expires_at: string
  revoked: boolean
}

export interface MockEmailCode {
  sent_at: number
  used: boolean
}

export interface MockMerchant {
  id: number
  name: string
  logo_url: string
  category_id: number
  area_id: number
  discount_summary: string
  discount_terms: string
  intro: string
  image_urls: string[]
  address: string
  latitude: number
  longitude: number
  phone: string
  opening_hours: string
  is_featured: boolean
  is_active: boolean
}

export interface MockImage {
  id: number
  url: string
  uploader_id: number
  check_status: ImageCheckStatus
}

export interface MockPost extends ModeratedContent {
  id: number
  board_id: number
  author_id: number
  title: string
  content: string
  image_ids: number[]
  like_count: number
  is_pinned: boolean
  created_at: string
  deleted: boolean
}

export interface MockComment extends ModeratedContent {
  id: number
  post_id: number
  author_id: number
  reply_to_user_id: number | null
  content: string
  created_at: string
  deleted: boolean
}

export interface MockDb {
  meId: number
  users: MockUser[]
  membership: MockMembership | null
  application: MembershipApplication | null
  membershipEmailOwners: Record<string, number>
  staffLoginChallenges: Record<string, { expires_at: number; confirmed_by: number | null }>
  emailCodes: Record<string, MockEmailCode>
  banners: Banner[]
  categories: Category[]
  areas: Area[]
  merchants: MockMerchant[]
  boards: Board[]
  images: MockImage[]
  posts: MockPost[]
  comments: MockComment[]
  likedPostIds: number[]
  reports: CreateReportBody[]
  nextId: number
}

export const DEFAULT_NICKNAME = '微信用户'
export const DELETED_NICKNAME = '已注销用户'

const ME_ID = 1

export function createUser(id: number): MockUser {
  return { id, nickname: DEFAULT_NICKNAME, avatar_url: null, banned_until: null, staff_role: null }
}

function createDb(): MockDb {
  const seed = createSeed(Date.now())
  return {
    meId: ME_ID,
    users: [createUser(ME_ID), ...seed.users],
    membership: null,
    application: null,
    membershipEmailOwners: {},
    staffLoginChallenges: {},
    emailCodes: {},
    banners: seed.banners,
    categories: seed.categories,
    areas: seed.areas,
    merchants: seed.merchants,
    boards: seed.boards,
    images: seed.images,
    posts: seed.posts,
    comments: seed.comments,
    likedPostIds: [],
    reports: [],
    nextId: 1000,
  }
}

let db: MockDb = createDb()

export function getDb(): MockDb {
  return db
}

export function resetDb(): void {
  db = createDb()
}

export function takeId(target: MockDb): number {
  target.nextId += 1
  return target.nextId
}

export function currentUser(target: MockDb): MockUser {
  const user = target.users.find((item) => item.id === target.meId)
  if (!user) throw new Error('假数据里找不到当前用户')
  return user
}
