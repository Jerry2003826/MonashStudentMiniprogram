import { MOCK_VERIFICATION_CODE } from '../../../config'
import type { Me } from '../../../types/api'
import { isStudentEmail, normalizeEmail } from '../../../utils/validate'
import { getDb } from '../db'
import { mockError, readString } from '../helpers'
import type { MockRequest, MockRoute } from '../router'
import { buildMe, DAY_MS, MEMBERSHIP_DAYS, RENEW_WINDOW_DAYS } from './me'

const MOCK_MEMBER_NO = '000123'
const RESEND_COOLDOWN_MS = 60 * 1000
const CODE_TTL_MS = 10 * 60 * 1000

function readEmail(body: unknown): string {
  const email = normalizeEmail(readString(body, 'email'))
  if (!isStudentEmail(email)) throw mockError('EMAIL_DOMAIN_NOT_ALLOWED')
  return email
}

function sendEmailCode({ body }: MockRequest): null {
  const email = readEmail(body)
  const db = getDb()
  const previous = db.emailCodes[email]
  if (previous && Date.now() - previous.sent_at < RESEND_COOLDOWN_MS) {
    throw mockError('RATE_LIMITED', '验证码发送太频繁，请 60 秒后再试')
  }
  db.emailCodes[email] = { sent_at: Date.now(), used: false }
  return null
}

function verifyEmail({ body }: MockRequest): Me {
  const email = readEmail(body)
  const db = getDb()
  const now = Date.now()
  const sent = db.emailCodes[email]
  const codeValid =
    sent !== undefined &&
    !sent.used &&
    now - sent.sent_at <= CODE_TTL_MS &&
    readString(body, 'code') === MOCK_VERIFICATION_CODE
  if (!codeValid) throw mockError('CODE_INVALID')
  sent.used = true

  const current = db.membership
  if (current?.revoked) throw mockError('MEMBERSHIP_REVOKED')
  if (current && current.email !== email) throw mockError('ALREADY_MEMBER')

  if (current) {
    const expiresAt = Date.parse(current.expires_at)
    if (expiresAt - now > RENEW_WINDOW_DAYS * DAY_MS) throw mockError('RENEWAL_NOT_OPEN')
    current.expires_at = new Date(Math.max(expiresAt, now) + MEMBERSHIP_DAYS * DAY_MS).toISOString()
  } else {
    db.membership = {
      email,
      member_no: MOCK_MEMBER_NO,
      expires_at: new Date(now + MEMBERSHIP_DAYS * DAY_MS).toISOString(),
      revoked: false,
    }
  }
  return buildMe(db)
}

export const membershipRoutes: MockRoute[] = [
  { method: 'POST', pattern: '/membership/email-code', handler: sendEmailCode },
  { method: 'POST', pattern: '/membership/verify', handler: verifyEmail },
]
