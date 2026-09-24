import type { LoginResult } from '../../../types/api'
import { getDb } from '../db'
import type { MockRoute } from '../router'
import { buildMe } from './me'

const MOCK_TOKEN = 'mock-token'

function login(): LoginResult {
  return { token: MOCK_TOKEN, me: buildMe(getDb()) }
}

export const authRoutes: MockRoute[] = [
  { method: 'POST', pattern: '/auth/wechat-login', handler: login },
]
