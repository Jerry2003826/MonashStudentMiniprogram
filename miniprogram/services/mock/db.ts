export interface MockUser {
  id: number
  nickname: string
  avatar_url: string | null
  banned_until: string | null
  is_staff: boolean
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

export interface MockDb {
  meId: number
  users: MockUser[]
  membership: MockMembership | null
  emailCodes: Record<string, MockEmailCode>
  nextId: number
}

export const DEFAULT_NICKNAME = '微信用户'
export const DELETED_NICKNAME = '已注销用户'

export function createUser(id: number): MockUser {
  return { id, nickname: DEFAULT_NICKNAME, avatar_url: null, banned_until: null, is_staff: false }
}

function createDb(): MockDb {
  return {
    meId: 1,
    users: [createUser(1)],
    membership: null,
    emailCodes: {},
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
