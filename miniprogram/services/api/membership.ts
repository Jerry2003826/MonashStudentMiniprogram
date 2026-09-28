import type { EmailCodeBody, Me, VerifyEmailBody } from '../../types/api'
import { setCachedMe } from '../auth'
import { request } from '../request'

export async function sendEmailCode(email: string): Promise<void> {
  const body: EmailCodeBody = { email }
  await request<null>({ method: 'POST', path: '/membership/email-code', body })
}

export async function verifyEmail(email: string, code: string): Promise<Me> {
  const body: VerifyEmailBody = { email, code }
  const me = await request<Me>({ method: 'POST', path: '/membership/applications', body })
  setCachedMe(me)
  return me
}
