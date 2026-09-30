import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDb } from '../../../../miniprogram/services/mock/db'
import type { Me, MembershipConfig } from '../../../../miniprogram/types/api'
import { call, errorCodeOf } from './call'

beforeEach(resetDb)

describe('mock membership config', () => {
  it('exposes the same allowlist enforced for verification', () => {
    getDb().membershipAllowedEmailDomains = [' Students.Example.edu ', 'alumni.example.org']
    const config = call<MembershipConfig>('GET', '/membership/config')
    expect(config.allowed_email_domains).toEqual(['students.example.edu', 'alumni.example.org'])
    for (const domain of config.allowed_email_domains) {
      expect(call('POST', '/membership/email-code', { email: `a@${domain}` })).toBeNull()
    }
    expect(
      errorCodeOf(() => call('POST', '/membership/email-code', { email: 'a@student.monash.edu' })),
    ).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
    const me = call<Me>('POST', '/membership/applications', {
      email: 'A@Alumni.Example.org',
      code: '123456',
    })
    expect(me.membership.application?.email).toBe('a@alumni.example.org')
    expect(me.membership.application?.status).toBe('pending')
  })

  it('returns a copy of the allowlist', () => {
    call<MembershipConfig>('GET', '/membership/config').allowed_email_domains.push('evil.test')
    expect(getDb().membershipAllowedEmailDomains).toEqual(['student.monash.edu'])
  })

  it('fails closed when the mock config is invalid', () => {
    getDb().membershipAllowedEmailDomains = []
    expect(errorCodeOf(() => call('GET', '/membership/config'))).toBe('INTERNAL_ERROR')
    expect(
      errorCodeOf(() => call('POST', '/membership/email-code', { email: 'a@student.monash.edu' })),
    ).toBe('INTERNAL_ERROR')
    expect(getDb().emailCodes).toEqual({})
  })
})
