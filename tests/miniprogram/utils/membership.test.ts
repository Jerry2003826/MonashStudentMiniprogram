import { describe, expect, it } from 'vitest'
import type { Me, MembershipInfo } from '../../../miniprogram/types/api'
import {
  CARD_URL,
  memberCardState,
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

describe('memberCardState', () => {
  it('未认证时不显示卡面，引导去认证', () => {
    expect(memberCardState(meWith({ state: 'none' }))).toMatchObject({
      variant: 'empty',
      action: '去认证',
      actionUrl: VERIFY_URL,
    })
  })

  it('有效会员显示有效卡面，没有额外操作', () => {
    expect(memberCardState(meWith({ state: 'active' }))).toMatchObject({
      variant: 'active',
      action: '',
    })
  })

  it('快到期的有效会员仍显示有效卡面，但提供续期入口', () => {
    expect(memberCardState(meWith({ state: 'active', renewable: true }))).toMatchObject({
      variant: 'active',
      action: '去续期',
      actionUrl: VERIFY_URL,
    })
  })

  it('已过期显示灰色卡面和续期入口', () => {
    expect(memberCardState(meWith({ state: 'expired' }))).toMatchObject({
      variant: 'inactive',
      badge: '已过期',
      action: '去续期',
    })
  })

  it('已取消显示灰色卡面，不能自行续期', () => {
    expect(memberCardState(meWith({ state: 'revoked' }))).toMatchObject({
      variant: 'inactive',
      badge: '已取消',
      action: '',
    })
  })
})
