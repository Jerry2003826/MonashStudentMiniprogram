import type { EmailCodeBody, Me, MembershipConfig, VerifyEmailBody } from '../../types/api'
import { normalizeEmailDomains } from '../../utils/validate'
import { setCachedMe } from '../auth'
import { ApiError } from '../errors'
import { request } from '../request'

export async function fetchMembershipConfig(): Promise<MembershipConfig> {
  const config = await request<MembershipConfig>({
    method: 'GET',
    path: '/membership/config',
    auth: false,
  })
  const domains = normalizeEmailDomains(config?.allowed_email_domains)
  if (!domains) throw new ApiError('INTERNAL_ERROR', '学生邮箱配置暂不可用，请刷新后重试')
  return { allowed_email_domains: domains }
}

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
