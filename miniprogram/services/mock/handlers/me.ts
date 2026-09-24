import type { MembershipInfo, Me } from '../../../types/api'
import {
  createUser,
  currentUser,
  DELETED_NICKNAME,
  getDb,
  takeId,
  type MockDb,
  type MockMembership,
} from '../db'
import { assertSafe, mockError, readString } from '../helpers'
import type { MockRequest, MockRoute } from '../router'

export const DAY_MS = 24 * 60 * 60 * 1000
export const MEMBERSHIP_DAYS = 365
export const RENEW_WINDOW_DAYS = 30
const NICKNAME_MAX_LENGTH = 20

export function membershipInfo(
  membership: MockMembership | null,
  now = Date.now(),
): MembershipInfo {
  if (!membership) {
    return { state: 'none', member_no: null, email: null, expires_at: null, renewable: false }
  }
  const expiresAt = Date.parse(membership.expires_at)
  const state = membership.revoked ? 'revoked' : expiresAt <= now ? 'expired' : 'active'
  const renewable =
    state === 'expired' || (state === 'active' && expiresAt - now <= RENEW_WINDOW_DAYS * DAY_MS)
  return {
    state,
    member_no: membership.member_no,
    email: membership.email,
    expires_at: membership.expires_at,
    renewable,
  }
}

export function buildMe(db: MockDb): Me {
  const user = currentUser(db)
  return {
    id: user.id,
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    banned_until: user.banned_until,
    membership: membershipInfo(db.membership),
  }
}

function updateNickname({ body }: MockRequest): Me {
  const nickname = readString(body, 'nickname').trim()
  if (nickname.length === 0 || nickname.length > NICKNAME_MAX_LENGTH) {
    throw mockError('VALIDATION_ERROR', `昵称需要 1 到 ${NICKNAME_MAX_LENGTH} 个字`)
  }
  assertSafe(nickname)
  const db = getDb()
  currentUser(db).nickname = nickname
  return buildMe(db)
}

function uploadAvatar({ body }: MockRequest): Me {
  const db = getDb()
  currentUser(db).avatar_url = readString(body, 'file_path') || null
  return buildMe(db)
}

function deleteAccount(): null {
  const db = getDb()
  const previous = currentUser(db)
  previous.nickname = DELETED_NICKNAME
  previous.avatar_url = null

  const fresh = createUser(takeId(db))
  db.users.push(fresh)
  db.meId = fresh.id
  db.membership = null
  db.emailCodes = {}
  return null
}

export const meRoutes: MockRoute[] = [
  { method: 'GET', pattern: '/me', handler: () => buildMe(getDb()) },
  { method: 'PUT', pattern: '/me', handler: updateNickname },
  { method: 'POST', pattern: '/me/avatar', handler: uploadAvatar },
  { method: 'DELETE', pattern: '/me', handler: deleteAccount },
]
