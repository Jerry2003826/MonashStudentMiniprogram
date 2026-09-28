import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '../../../../miniprogram/services/mock/db'
import type { Me } from '../../../../miniprogram/types/api'
import { approveMockApplication, rejectMockApplication } from '../../helpers/membership'
import { call, errorCodeOf } from './call'

const DAY_MS = 24 * 60 * 60 * 1000
const EMAIL = 'jli0001@student.monash.edu'

function sendCode(email = EMAIL): unknown {
  return call('POST', '/membership/email-code', { email })
}

function apply(code = '123456', email = EMAIL): Me {
  return call<Me>('POST', '/membership/applications', { email, code })
}

function approvedMember(): void {
  sendCode()
  apply()
  approveMockApplication()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T10:00:00+10:00'))
  resetDb()
})

afterEach(() => vi.useRealTimers())

describe('发送验证码', () => {
  it('拒绝非学生邮箱，同一邮箱 60 秒内不能重复发送', () => {
    expect(errorCodeOf(() => sendCode('someone@gmail.com'))).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
    sendCode()
    expect(errorCodeOf(() => sendCode())).toBe('RATE_LIMITED')
    vi.advanceTimersByTime(61 * 1000)
    expect(() => sendCode()).not.toThrow()
  })
})

describe('人工审核申请', () => {
  it('未发送、错误和过期的验证码不能创建申请', () => {
    expect(errorCodeOf(() => apply())).toBe('CODE_INVALID')
    sendCode()
    expect(errorCodeOf(() => apply('000000'))).toBe('CODE_INVALID')
    vi.advanceTimersByTime(11 * 60 * 1000)
    expect(errorCodeOf(() => apply())).toBe('CODE_INVALID')
    expect(getDb().application).toBeNull()
  })

  it('正确验证码只创建 pending，不授予会员卡或会员资格', () => {
    sendCode('JLI0001@Student.Monash.edu')
    const me = apply()
    expect(me.membership).toMatchObject({
      state: 'none',
      member_no: null,
      expires_at: null,
      renewable: false,
    })
    expect(me.membership.application).toMatchObject({
      email: EMAIL,
      status: 'pending',
      reviewed_at: null,
      review_note: '',
    })
    expect(getDb().membership).toBeNull()
    expect(me.staff_role).toBeNull()
  })

  it('待审时禁止重复申请，也不会消耗新验证码或替换待审记录', () => {
    sendCode()
    const first = apply().membership.application
    vi.advanceTimersByTime(61 * 1000)
    sendCode()
    expect(errorCodeOf(() => apply())).toBe('VALIDATION_ERROR')
    expect(getDb().application?.id).toBe(first?.id)
    expect(getDb().emailCodes[EMAIL].used).toBe(false)
  })

  it('待审和被拒绝用户均不能发帖、评论、点赞或上传图片', () => {
    sendCode()
    apply()
    const protectedActions = [
      () =>
        call('POST', '/forum/posts', {
          board_id: 1,
          title: '测试',
          content: '正文',
          image_ids: [],
        }),
      () => call('POST', '/forum/posts/2/comments', { content: '评论' }),
      () => call('PUT', '/forum/posts/2/like'),
      () => call('POST', '/forum/images', { file_path: 'wxfile://test.jpg' }),
    ]
    for (const action of protectedActions) expect(errorCodeOf(action)).toBe('MEMBERSHIP_REQUIRED')
    rejectMockApplication()
    for (const action of protectedActions) expect(errorCodeOf(action)).toBe('MEMBERSHIP_REQUIRED')
  })

  it('后台拒绝后展示原因，旧验证码不能重用，新验证码可重新申请', () => {
    sendCode()
    const firstId = apply().membership.application?.id
    rejectMockApplication('请提供当前学期的学生信息')
    const rejected = call<Me>('GET', '/me')
    expect(rejected.membership.state).toBe('none')
    expect(rejected.membership.application?.review_note).toBe('请提供当前学期的学生信息')
    expect(errorCodeOf(() => apply())).toBe('CODE_INVALID')
    vi.advanceTimersByTime(61 * 1000)
    sendCode()
    const reapplied = apply()
    expect(reapplied.membership.application?.status).toBe('pending')
    expect(reapplied.membership.application?.id).not.toBe(firstId)
    expect(reapplied.membership.application?.review_note).toBe('')
    expect(reapplied.membership.state).toBe('none')
  })

  it('仅受控后台审核 fixture 批准后，读取到有效资格并获得论坛权限', () => {
    approvedMember()
    const me = call<Me>('GET', '/me')
    expect(me.membership.state).toBe('active')
    expect(me.membership.application?.status).toBe('approved')
    expect(Date.parse(me.membership.expires_at!)).toBe(Date.now() + 365 * DAY_MS)
    expect(() => call('PUT', '/forum/posts/2/like')).not.toThrow()
    expect(
      errorCodeOf(() => call('POST', '/membership/verify', { email: EMAIL, code: '123456' })),
    ).toBe('NOT_FOUND')
    expect(errorCodeOf(() => call('POST', '/membership/approve', {}))).toBe('NOT_FOUND')
  })

  it('到期超过 30 天时不能提交续期申请', () => {
    approvedMember()
    vi.advanceTimersByTime(61 * 1000)
    sendCode()
    expect(errorCodeOf(() => apply())).toBe('RENEWAL_NOT_OPEN')
  })

  it('续期待审核时保持旧会员卡和到期日，人工通过后才延长', () => {
    approvedMember()
    const firstExpiry = getDb().membership!.expires_at
    vi.advanceTimersByTime(340 * DAY_MS)
    sendCode()
    const pending = apply()
    expect(pending.membership).toMatchObject({
      state: 'active',
      expires_at: firstExpiry,
      renewable: true,
    })
    expect(pending.membership.application?.status).toBe('pending')
    expect(() => call('PUT', '/forum/posts/2/like')).not.toThrow()
    approveMockApplication()
    expect(Date.parse(call<Me>('GET', '/me').membership.expires_at!)).toBe(
      Date.parse(firstExpiry) + 365 * DAY_MS,
    )
  })

  it('已过期用户提交续期后仍无权限，批准后才恢复', () => {
    approvedMember()
    vi.advanceTimersByTime(400 * DAY_MS)
    sendCode()
    expect(apply().membership.state).toBe('expired')
    expect(errorCodeOf(() => call('PUT', '/forum/posts/2/like'))).toBe('MEMBERSHIP_REQUIRED')
    approveMockApplication()
    const me = call<Me>('GET', '/me')
    expect(me.membership.state).toBe('active')
    expect(Date.parse(me.membership.expires_at!)).toBe(Date.now() + 365 * DAY_MS)
  })

  it('被撤销资格无法自行重申请，已归属其他用户的邮箱不能接管', () => {
    approvedMember()
    getDb().membership!.revoked = true
    vi.advanceTimersByTime(61 * 1000)
    sendCode()
    expect(errorCodeOf(() => apply())).toBe('MEMBERSHIP_REVOKED')
    resetDb()
    getDb().membershipEmailOwners[EMAIL] = 99
    sendCode()
    expect(errorCodeOf(() => apply())).toBe('ALREADY_MEMBER')
    expect(getDb().membershipEmailOwners[EMAIL]).toBe(99)
    expect(getDb().membership).toBeNull()
  })
})
