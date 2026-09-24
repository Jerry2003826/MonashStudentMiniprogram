import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../../../miniprogram/services/mock/db'
import type { Me } from '../../../../miniprogram/types/api'
import { call, errorCodeOf } from './call'

const DAY_MS = 24 * 60 * 60 * 1000
const EMAIL = 'jli0001@student.monash.edu'

function sendCode(email = EMAIL): unknown {
  return call('POST', '/membership/email-code', { email })
}

function verify(code = '123456', email = EMAIL): Me {
  return call<Me>('POST', '/membership/verify', { email, code })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T10:00:00+10:00'))
  resetDb()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('发送验证码', () => {
  it('拒绝不是 @student.monash.edu 的邮箱', () => {
    expect(errorCodeOf(() => sendCode('someone@gmail.com'))).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
  })

  it('同一邮箱 60 秒内只能发送一次', () => {
    sendCode()

    expect(errorCodeOf(() => sendCode())).toBe('RATE_LIMITED')

    vi.advanceTimersByTime(61 * 1000)
    expect(() => sendCode()).not.toThrow()
  })
})

describe('提交验证码', () => {
  it('没有发送过验证码时提交会失败', () => {
    expect(errorCodeOf(() => verify())).toBe('CODE_INVALID')
  })

  it('验证码错误时失败', () => {
    sendCode()

    expect(errorCodeOf(() => verify('000000'))).toBe('CODE_INVALID')
  })

  it('验证码正确时成为有效会员，有效期 365 天', () => {
    sendCode()

    const me = verify()

    expect(me.membership.state).toBe('active')
    expect(me.membership.member_no).toBe('000123')
    expect(me.membership.email).toBe(EMAIL)
    expect(me.membership.renewable).toBe(false)
    expect(Date.parse(me.membership.expires_at ?? '')).toBe(Date.now() + 365 * DAY_MS)
  })

  it('邮箱大小写不同也算同一个邮箱', () => {
    sendCode('JLI0001@Student.Monash.edu')

    expect(verify('123456', EMAIL).membership.state).toBe('active')
  })

  it('距离到期超过 30 天时不能续期', () => {
    sendCode()
    verify()
    vi.advanceTimersByTime(61 * 1000)
    sendCode()

    expect(errorCodeOf(() => verify())).toBe('RENEWAL_NOT_OPEN')
  })

  it('到期前 30 天内可以续期，新到期日在原到期日基础上顺延 365 天', () => {
    sendCode()
    const firstExpiry = Date.parse(verify().membership.expires_at ?? '')

    vi.advanceTimersByTime(340 * DAY_MS)
    expect(call<Me>('GET', '/me').membership.renewable).toBe(true)
    sendCode()
    const renewed = verify()

    expect(Date.parse(renewed.membership.expires_at ?? '')).toBe(firstExpiry + 365 * DAY_MS)
  })

  it('过期后续期，从续期当天起算 365 天', () => {
    sendCode()
    verify()

    vi.advanceTimersByTime(400 * DAY_MS)
    expect(call<Me>('GET', '/me').membership.state).toBe('expired')
    sendCode()
    const renewed = verify()

    expect(renewed.membership.state).toBe('active')
    expect(Date.parse(renewed.membership.expires_at ?? '')).toBe(Date.now() + 365 * DAY_MS)
  })

  it('已经用一个邮箱认证过，不能再绑定另一个邮箱', () => {
    sendCode()
    verify()
    const other = 'other0002@student.monash.edu'
    sendCode(other)

    expect(errorCodeOf(() => verify('123456', other))).toBe('ALREADY_MEMBER')
  })
})
