import type { Me } from '../types/api'
import { formatDate } from './format'

export const VERIFY_URL = '/pages/verify/index'
export const CARD_URL = '/pages/member-card/index'

export interface MemberEntry {
  title: string
  description: string
  action: string
  url: string
}

export interface MemberStatus {
  text: string
  url: string
  highlight: boolean
}

export function profileMemberStatus(me: Me | null): MemberStatus {
  const membership = me?.membership
  const state = membership?.state ?? 'none'
  const expiry = membership?.expires_at ? formatDate(membership.expires_at) : ''
  switch (state) {
    case 'none':
      return { text: '未认证，去认证', url: VERIFY_URL, highlight: true }
    case 'active':
      return membership?.renewable
        ? { text: `${expiry} 到期，去续期`, url: VERIFY_URL, highlight: true }
        : { text: `有效期至 ${expiry}`, url: CARD_URL, highlight: false }
    case 'expired':
      return { text: '已过期，去续期', url: VERIFY_URL, highlight: true }
    case 'revoked':
      return { text: '已取消', url: CARD_URL, highlight: false }
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}

export type CardVariant = 'active' | 'inactive' | 'empty'

export interface MemberCardState {
  variant: CardVariant
  badge: string
  hint: string
  action: string
  actionUrl: string
}

export function memberCardState(me: Me | null): MemberCardState {
  const membership = me?.membership
  const state = membership?.state ?? 'none'
  switch (state) {
    case 'none':
      return {
        variant: 'empty',
        badge: '',
        hint: '完成学生认证后，就能领取电子会员卡',
        action: '去认证',
        actionUrl: VERIFY_URL,
      }
    case 'active':
      return membership?.renewable
        ? {
            variant: 'active',
            badge: '有效',
            hint: '会员快到期了，续期只需要重新验证一次学生邮箱',
            action: '去续期',
            actionUrl: VERIFY_URL,
          }
        : {
            variant: 'active',
            badge: '有效',
            hint: '请向商家出示此页面。时间实时跳动，截图无效。',
            action: '',
            actionUrl: '',
          }
    case 'expired':
      return {
        variant: 'inactive',
        badge: '已过期',
        hint: '重新验证学生邮箱即可续期',
        action: '去续期',
        actionUrl: VERIFY_URL,
      }
    case 'revoked':
      return {
        variant: 'inactive',
        badge: '已取消',
        hint: '会员资格已被取消，如有疑问请联系学生会',
        action: '',
        actionUrl: '',
      }
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}

export function memberEntry(me: Me | null): MemberEntry {
  const membership = me?.membership
  const state = membership?.state ?? 'none'
  switch (state) {
    case 'none':
      return {
        title: '学生认证，免费成为会员',
        description: '验证 Monash 学生邮箱，在合作商家享受会员折扣',
        action: '去认证',
        url: VERIFY_URL,
      }
    case 'active': {
      const expiry = membership?.expires_at ? formatDate(membership.expires_at) : ''
      const hint = membership?.renewable ? '（即将到期，记得续期）' : ''
      return {
        title: '我的会员卡',
        description: `会员编号 ${membership?.member_no ?? ''} · 有效期至 ${expiry}${hint}`,
        action: '出示会员卡',
        url: CARD_URL,
      }
    }
    case 'expired':
      return {
        title: '会员已过期',
        description: '重新验证学生邮箱即可续期',
        action: '去续期',
        url: VERIFY_URL,
      }
    case 'revoked':
      return {
        title: '会员资格已取消',
        description: '如有疑问，请联系学生会',
        action: '查看详情',
        url: CARD_URL,
      }
    default: {
      const unreachable: never = state
      return unreachable
    }
  }
}
