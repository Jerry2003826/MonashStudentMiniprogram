import { beforeEach, describe, expect, it } from 'vitest'
import { currentUser, getDb, resetDb } from '../../../../miniprogram/services/mock/db'
import type { Me } from '../../../../miniprogram/types/api'
import { call, errorCodeOf } from './call'

beforeEach(() => resetDb())

describe('微信身份确认后台登录', () => {
  it('普通用户没有角色，不能用任何确认码获得管理员会话或自行赋权', () => {
    getDb().staffLoginChallenges['123456'] = { expires_at: Date.now() + 60000, confirmed_by: null }
    expect(call<Me>('GET', '/me').staff_role).toBeNull()
    expect(errorCodeOf(() => call('POST', '/staff/login/confirm', { code: '123456' }))).toBe(
      'FORBIDDEN',
    )
    call('PUT', '/me', { nickname: '同学', staff_role: 'owner' })
    expect(call<Me>('GET', '/me').staff_role).toBeNull()
    expect(getDb().staffLoginChallenges['123456'].confirmed_by).toBeNull()
  })

  it.each(['owner', 'reviewer', 'editor'] as const)(
    '%s 只能确认已存在、未过期、未使用的浏览器挑战',
    (role) => {
      currentUser(getDb()).staff_role = role
      expect(errorCodeOf(() => call('POST', '/staff/login/confirm', { code: '654321' }))).toBe(
        'CODE_INVALID',
      )
      getDb().staffLoginChallenges['123456'] = {
        expires_at: Date.now() + 60000,
        confirmed_by: null,
      }
      expect(call('POST', '/staff/login/confirm', { code: '123456' })).toEqual({ confirmed: true })
      expect(getDb().staffLoginChallenges['123456'].confirmed_by).toBe(getDb().meId)
      expect(errorCodeOf(() => call('POST', '/staff/login/confirm', { code: '123456' }))).toBe(
        'CODE_INVALID',
      )
      getDb().staffLoginChallenges['222222'] = { expires_at: Date.now() - 1, confirmed_by: null }
      expect(errorCodeOf(() => call('POST', '/staff/login/confirm', { code: '222222' }))).toBe(
        'CODE_INVALID',
      )
    },
  )
})
