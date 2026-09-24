const TOKEN_KEY = 'auth_token'

export function getToken(): string | null {
  const token: unknown = wx.getStorageSync(TOKEN_KEY)
  return typeof token === 'string' && token !== '' ? token : null
}

export function setToken(token: string): void {
  wx.setStorageSync(TOKEN_KEY, token)
}

export function clearToken(): void {
  wx.removeStorageSync(TOKEN_KEY)
}
