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
    staff_role: null,
    membership: {
      state: 'none',
      member_no: null,
      email: null,
      expires_at: null,
      renewable: false,
      application: null,
      ...membership,
    },
  }
}

describe('memberEntry', () => {
  it('还没登录或没认证时引导去申请', () => {
    expect(memberEntry(null)).toMatchObject({ action: '去申请', url: VERIFY_URL })
    expect(memberEntry(meWith({ state: 'none' }))).toMatchObject({
      action: '去申请',
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

  it('已过期时引导申请续期', () => {
    expect(memberEntry(meWith({ state: 'expired' }))).toMatchObject({
      action: '申请续期',
      url: VERIFY_URL,
    })
  })

  it('已被取消时入口是会员卡页，由会员卡页说明原因', () => {
    expect(memberEntry(meWith({ state: 'revoked' })).url).toBe(CARD_URL)
  })
})

describe('profileMemberStatus', () => {
  it('未认证时提示去申请', () => {
    expect(profileMemberStatus(meWith({ state: 'none' }))).toEqual({
      text: '申请会员，审核通过后可用',
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
    ).toEqual({ text: '2026-10-10 到期，申请续期', url: VERIFY_URL, highlight: true })
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
  it.each(['pending', 'rejected'] as const)('%s 申请不产生有效卡或出示会员卡入口', (status) => {
    const me = meWith({
      application: {
        id: 1,
        email: 'a@student.monash.edu',
        status,
        submitted_at: '2026-09-28T00:00:00Z',
        reviewed_at: null,
        review_note: status === 'rejected' ? '请补充材料' : '',
      },
    })
    expect(memberCardState(me).variant).toBe('empty')
    expect(memberCardState(me).actionUrl).toBe(VERIFY_URL)
    expect(memberEntry(me).url).toBe(VERIFY_URL)
    expect(profileMemberStatus(me).url).toBe(VERIFY_URL)
    if (status === 'rejected') expect(memberCardState(me).hint).toContain('请补充材料')
  })

  it('有效会员续期待审时仍可出示原卡，过期后不能继续用', () => {
    const membership: Partial<MembershipInfo> = {
      state: 'active',
      renewable: true,
      application: {
        id: 2,
        email: 'a@student.monash.edu',
        status: 'pending',
        submitted_at: '2026-09-28T00:00:00Z',
        reviewed_at: null,
        review_note: '',
      },
    }
    expect(memberCardState(meWith(membership)).variant).toBe('active')
    expect(memberEntry(meWith(membership)).url).toBe(CARD_URL)
    expect(profileMemberStatus(meWith(membership)).text).toContain('续期审核中')
    expect(memberCardState(meWith({ ...membership, state: 'expired' })).variant).toBe('inactive')
    expect(memberEntry(meWith({ ...membership, state: 'expired' })).url).toBe(VERIFY_URL)
  })

  it('未认证时不显示卡面，引导去申请', () => {
    expect(memberCardState(meWith({ state: 'none' }))).toMatchObject({
      variant: 'empty',
      action: '申请会员',
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
      action: '申请续期',
      actionUrl: VERIFY_URL,
    })
  })

  it('已过期显示灰色卡面和续期入口', () => {
    expect(memberCardState(meWith({ state: 'expired' }))).toMatchObject({
      variant: 'inactive',
      badge: '已过期',
      action: '申请续期',
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
