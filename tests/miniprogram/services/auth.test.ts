import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureLogin,
  getCachedMe,
  isActiveMember,
  logout,
  relogin,
} from '../../../miniprogram/services/auth'
import type { Me } from '../../../miniprogram/types/api'
import { installFakeWx } from '../helpers/wx'

vi.mock('../../../miniprogram/config', () => ({
  MOCK_DELAY_MS: 0,
  getDevelopmentLoginUsername: () => null,
  isMockEnabled: () => false,
  getApiBaseUrl: () => 'https://api.test/api/v1',
}))

function makeMe(state: Me['membership']['state']): Me {
  return {
    id: 1,
    nickname: '微信用户',
    avatar_url: null,
    banned_until: null,
    staff_role: null,
    membership: {
      state,
      member_no: null,
      email: null,
      expires_at: null,
      renewable: false,
      application: null,
    },
  }
}

let fake: ReturnType<typeof installFakeWx>

beforeEach(() => {
  fake = installFakeWx()
  logout()
  let issued = 0
  fake.respondWith((options) => {
    if (options.url.endsWith('/auth/wechat-login')) {
      issued += 1
      return { statusCode: 200, data: { token: `token-${issued}`, me: makeMe('none') } }
    }
    return { statusCode: 404, data: { code: 'NOT_FOUND', message: '不存在' } }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ensureLogin', () => {
  it('没有 token 时调用 wx.login，并保存后端返回的 token', async () => {
    await ensureLogin()

    expect(fake.login).toHaveBeenCalledTimes(1)
    expect(fake.request.mock.calls[0][0].data).toEqual({ code: 'fake-code-1' })
    expect(fake.storage.get('auth_token')).toBe('token-1')
    expect(getCachedMe()?.nickname).toBe('微信用户')
  })

  it('已有 token 时不再登录', async () => {
    fake.storage.set('auth_token', 'existing')

    await ensureLogin()

    expect(fake.login).not.toHaveBeenCalled()
  })

  it('同时调用多次只登录一次', async () => {
    await Promise.all([ensureLogin(), ensureLogin(), ensureLogin()])

    expect(fake.login).toHaveBeenCalledTimes(1)
  })
})

describe('relogin', () => {
  it('清掉旧 token 后重新登录', async () => {
    fake.storage.set('auth_token', 'expired')

    await relogin()

    expect(fake.login).toHaveBeenCalledTimes(1)
    expect(fake.storage.get('auth_token')).toBe('token-1')
  })
})

describe('isActiveMember', () => {
  it('只有状态为 active 的会员才算有效会员', () => {
    expect(isActiveMember(makeMe('active'))).toBe(true)
    expect(isActiveMember(makeMe('expired'))).toBe(false)
    expect(isActiveMember(makeMe('none'))).toBe(false)
    expect(isActiveMember(null)).toBe(false)
  })
})
