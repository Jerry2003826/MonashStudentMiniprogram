import { MOCK_VERIFICATION_CODE } from '../../../config'
import type { Me } from '../../../types/api'
import { isStudentEmail, normalizeEmail } from '../../../utils/validate'
import { getDb, takeId } from '../db'
import { mockError, readString } from '../helpers'
import type { MockRequest, MockRoute } from '../router'
import { buildMe, DAY_MS, RENEW_WINDOW_DAYS } from './me'

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

function submitApplication({ body }: MockRequest): Me {
  const email = readEmail(body)
  const db = getDb()
  const now = Date.now()
  const emailOwner = db.membershipEmailOwners[email]
  if (emailOwner !== undefined && emailOwner !== db.meId) throw mockError('ALREADY_MEMBER')
  if (db.application?.status === 'pending') {
    throw mockError('VALIDATION_ERROR', '你的申请正在审核中，请勿重复提交')
  }
  const current = db.membership
  if (current?.revoked) throw mockError('MEMBERSHIP_REVOKED')
  if (current && current.email !== email) throw mockError('ALREADY_MEMBER')
  if (current && Date.parse(current.expires_at) - now > RENEW_WINDOW_DAYS * DAY_MS) {
    throw mockError('RENEWAL_NOT_OPEN')
  }
  const sent = db.emailCodes[email]
  const codeValid =
    sent !== undefined &&
    !sent.used &&
    now - sent.sent_at <= CODE_TTL_MS &&
    readString(body, 'code') === MOCK_VERIFICATION_CODE
  if (!codeValid) throw mockError('CODE_INVALID')
  sent.used = true

  // 邮箱验证只证明邮箱归属；会员资格只能由后台人工审核授予。
  db.application = {
    id: takeId(db),
    email,
    status: 'pending',
    submitted_at: new Date(now).toISOString(),
    reviewed_at: null,
    review_note: '',
  }
  return buildMe(db)
}

export const membershipRoutes: MockRoute[] = [
  { method: 'POST', pattern: '/membership/email-code', handler: sendEmailCode },
  { method: 'POST', pattern: '/membership/applications', handler: submitApplication },
]
