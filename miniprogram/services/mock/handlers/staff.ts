import { currentUser, getDb } from '../db'
import { mockError, readString } from '../helpers'
import type { MockRequest, MockRoute } from '../router'

function confirmLogin({ body }: MockRequest): { confirmed: true } {
  const db = getDb()
  const user = currentUser(db)
  if (!user.staff_role) throw mockError('FORBIDDEN', '当前微信账号没有后台管理员权限')
  const code = readString(body, 'code')
  const challenge = db.staffLoginChallenges[code]
  if (
    !/^\d{6}$/.test(code) ||
    !challenge ||
    challenge.expires_at <= Date.now() ||
    challenge.confirmed_by !== null
  ) {
    throw mockError('CODE_INVALID', '确认码无效或已过期，请回到浏览器重新获取')
  }
  challenge.confirmed_by = user.id
  return { confirmed: true }
}

// 开发模式不会生成后台挑战或授予管理员；测试由隔离的受控 fixture 设置。
export const staffRoutes: MockRoute[] = [
  { method: 'POST', pattern: '/staff/login/confirm', handler: confirmLogin },
]
