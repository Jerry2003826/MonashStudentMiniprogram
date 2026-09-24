import { describe, expect, it } from 'vitest'
import type { Me, MembershipInfo } from '../../../miniprogram/types/api'
import {
  CARD_URL,
  memberEntry,
  profileMemberStatus,
  VERIFY_URL,
} from '../../../miniprogram/utils/membership'

function meWith(membership: Partial<MembershipInfo>): Me {
  return {
    id: 1,
    nickname: '小蒙',
    avatar_url: null,
    banned_until: null,
    membership: {
      state: 'none',
      member_no: null,
      email: null,
      expires_at: null,
      renewable: false,
      ...membership,
    },
  }
}

describe('memberEntry', () => {
  it('还没登录或没认证时引导去认证', () => {
    expect(memberEntry(null)).toMatchObject({ action: '去认证', url: VERIFY_URL })
    expect(memberEntry(meWith({ state: 'none' }))).toMatchObject({
      action: '去认证',
      url: VERIFY_URL,
    })
  })

  it('有效会员显示会员编号和有效期，入口是会员卡', () => {
    const entry = memberEntry(
      meWith({ state: 'active', member_no: '000123', expires_at: '2027-09-24T12:00:00+10:00' }),
    )

    expect(entry.url).toBe(CARD_URL)
    expect(entry.description).toContain('000123')
    expect(entry.description).toContain('2027-09-24')
    expect(entry.description).not.toContain('即将到期')
  })

  it('快到期的有效会员提示续期', () => {
    const entry = memberEntry(
      meWith({
        state: 'active',
        member_no: '000123',
        expires_at: '2026-10-10T12:00:00+10:00',
        renewable: true,
      }),
    )

    expect(entry.description).toContain('即将到期')
  })

  it('已过期时引导去续期', () => {
    expect(memberEntry(meWith({ state: 'expired' }))).toMatchObject({
      action: '去续期',
      url: VERIFY_URL,
    })
  })

  it('已被取消时入口是会员卡页，由会员卡页说明原因', () => {
    expect(memberEntry(meWith({ state: 'revoked' })).url).toBe(CARD_URL)
  })
})

describe('profileMemberStatus', () => {
  it('未认证时提示去认证', () => {
    expect(profileMemberStatus(meWith({ state: 'none' }))).toEqual({
      text: '未认证，去认证',
      url: VERIFY_URL,
      highlight: true,
    })
  })

  it('有效会员显示有效期，点击进入会员卡', () => {
    expect(
      profileMemberStatus(meWith({ state: 'active', expires_at: '2027-09-24T12:00:00+10:00' })),
    ).toEqual({ text: '有效期至 2027-09-24', url: CARD_URL, highlight: false })
  })

  it('快到期时提示续期', () => {
    expect(
      profileMemberStatus(
        meWith({ state: 'active', expires_at: '2026-10-10T12:00:00+10:00', renewable: true }),
      ),
    ).toEqual({ text: '2026-10-10 到期，去续期', url: VERIFY_URL, highlight: true })
  })

  it('已过期时提示续期', () => {
    expect(profileMemberStatus(meWith({ state: 'expired' }))).toMatchObject({
      url: VERIFY_URL,
      highlight: true,
    })
  })

  it('已取消时点击进入会员卡页查看原因', () => {
    expect(profileMemberStatus(meWith({ state: 'revoked' }))).toMatchObject({
      text: '已取消',
      url: CARD_URL,
    })
  })
})
