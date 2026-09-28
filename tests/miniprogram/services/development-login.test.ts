import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureLogin, getCachedMe, logout } from '../../../miniprogram/services/auth'
import type { Me } from '../../../miniprogram/types/api'
import { installFakeWx } from '../helpers/wx'

const config = vi.hoisted(() => ({ username: null as string | null }))

vi.mock('../../../miniprogram/config', () => ({
  MOCK_DELAY_MS: 0,
  isMockEnabled: () => false,
  getApiBaseUrl: () => 'http://127.0.0.1:8000/api/v1',
  getDevelopmentLoginUsername: () => config.username,
}))

const me: Me = {
  id: 1,
  nickname: '本地演示学生',
  avatar_url: null,
  banned_until: null,
  staff_role: null,
  membership: {
    state: 'none',
    member_no: null,
    email: null,
    expires_at: null,
    renewable: false,
    application: null,
  },
}

let fake: ReturnType<typeof installFakeWx>

beforeEach(() => {
  config.username = null
  fake = installFakeWx()
  logout()
})

afterEach(() => vi.unstubAllGlobals())

describe('显式本地开发登录', () => {
  it('使用独立端点，不把演示身份当成微信 code 发送', async () => {
    config.username = 'demo-student'
    fake.respondWith(() => ({ statusCode: 200, data: { token: 'local-test-token', me } }))

    await ensureLogin()

    expect(fake.login).not.toHaveBeenCalled()
    const request = fake.request.mock.calls[0][0]
    expect(request.url).toBe('http://127.0.0.1:8000/api/v1/auth/dev-login')
    expect(request.data).toEqual({ username: 'demo-student' })
    expect(getCachedMe()?.membership.state).toBe('none')
  })

  it('开发登录被后端拒绝时，不假装成功或回退成另一身份', async () => {
    config.username = 'demo-owner'
    fake.respondWith(() => ({
      statusCode: 404,
      data: { code: 'NOT_FOUND', message: '开发登录不可用' },
    }))

    await expect(ensureLogin()).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(fake.request).toHaveBeenCalledTimes(1)
    expect(fake.login).not.toHaveBeenCalled()
    expect(fake.storage.get('auth_token')).toBeUndefined()
    expect(getCachedMe()).toBeNull()
  })

  it('微信没有返回 code 时不向后端发送空凭证', async () => {
    fake.login.mockImplementationOnce((options) => options.success?.({ code: '' }))

    await expect(ensureLogin()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })

    expect(fake.request).not.toHaveBeenCalled()
  })
})
