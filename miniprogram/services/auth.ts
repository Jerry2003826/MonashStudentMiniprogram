import type { LoginResult, Me } from '../types/api'
import { ApiError } from './errors'
import { request } from './request'
import { clearToken, getToken, setToken } from './token'

let loginPromise: Promise<void> | null = null
let cachedMe: Me | null = null

function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => resolve(res.code),
      fail: () => reject(new ApiError('NETWORK_ERROR', '微信登录失败，请稍后再试')),
    })
  })
}

async function login(): Promise<void> {
  const code = await wxLogin()
  const result = await request<LoginResult>({
    method: 'POST',
    path: '/auth/wechat-login',
    body: { code },
    auth: false,
  })
  setToken(result.token)
  cachedMe = result.me
}

export function ensureLogin(): Promise<void> {
  if (getToken()) return Promise.resolve()
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null
    })
  }
  return loginPromise
}

export function relogin(): Promise<void> {
  clearToken()
  cachedMe = null
  return ensureLogin()
}

export function logout(): void {
  clearToken()
  cachedMe = null
}

export async function fetchMe(): Promise<Me> {
  await ensureLogin()
  const me = await request<Me>({ method: 'GET', path: '/me' })
  cachedMe = me
  return me
}

export function getCachedMe(): Me | null {
  return cachedMe
}

export function setCachedMe(me: Me): void {
  cachedMe = me
}

export function isActiveMember(me: Me | null): boolean {
  return me?.membership.state === 'active'
}
