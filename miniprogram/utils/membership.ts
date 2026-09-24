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
