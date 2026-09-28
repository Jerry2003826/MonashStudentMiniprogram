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
  const application = membership?.application
  if (membership?.state === 'revoked') return { text: '已取消', url: CARD_URL, highlight: false }
  if (application?.status === 'pending') {
    return {
      text: membership?.state === 'active' ? '续期审核中，当前卡仍有效' : '会员申请审核中',
      url: VERIFY_URL,
      highlight: true,
    }
  }
  if (membership?.state === 'active') {
    const expiry = membership.expires_at ? formatDate(membership.expires_at) : ''
    return membership.renewable
      ? {
          text:
            application?.status === 'rejected'
              ? '续期未通过，查看原因'
              : `${expiry} 到期，申请续期`,
          url: VERIFY_URL,
          highlight: true,
        }
      : { text: `有效期至 ${expiry}`, url: CARD_URL, highlight: false }
  }
  if (application?.status === 'rejected')
    return { text: '申请未通过，查看原因', url: VERIFY_URL, highlight: true }
  if (membership?.state === 'expired')
    return { text: '已过期，申请续期', url: VERIFY_URL, highlight: true }
  return { text: '申请会员，审核通过后可用', url: VERIFY_URL, highlight: true }
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
  const application = membership?.application
  if (membership?.state === 'revoked') {
    return {
      variant: 'inactive',
      badge: '已取消',
      hint: '会员资格已被取消，如有疑问请联系学生会',
      action: '',
      actionUrl: '',
    }
  }
  if (membership?.state === 'active') {
    if (application?.status === 'pending') {
      return {
        variant: 'active',
        badge: '有效',
        hint: '续期申请正在审核，当前会员卡仍有效至原到期日。',
        action: '查看续期申请',
        actionUrl: VERIFY_URL,
      }
    }
    if (membership.renewable) {
      return {
        variant: 'active',
        badge: '有效',
        hint:
          application?.status === 'rejected'
            ? `续期申请未通过：${application.review_note || '请联系学生会了解原因'}。当前资格仍有效至原到期日。`
            : '会员即将到期，提交续期申请并经人工审核通过后延长有效期。',
        action: '申请续期',
        actionUrl: VERIFY_URL,
      }
    }
    return {
      variant: 'active',
      badge: '有效',
      hint: '请向商家出示此页面。时间实时跳动，截图无效。',
      action: '',
      actionUrl: '',
    }
  }
  const variant = membership?.state === 'expired' ? 'inactive' : 'empty'
  if (application?.status === 'pending') {
    return {
      variant,
      badge: variant === 'inactive' ? '已过期' : '申请审核中',
      hint: '会员申请正在人工审核中，审核通过前不能使用会员卡或会员专属功能。',
      action: '查看申请状态',
      actionUrl: VERIFY_URL,
    }
  }
  if (application?.status === 'rejected') {
    return {
      variant,
      badge: variant === 'inactive' ? '已过期' : '申请未通过',
      hint: `审核意见：${application.review_note || '请联系学生会了解原因'}。可修改后重新申请。`,
      action: '重新申请',
      actionUrl: VERIFY_URL,
    }
  }
  return variant === 'inactive'
    ? {
        variant,
        badge: '已过期',
        hint: '提交续期申请，人工审核通过后恢复会员资格。',
        action: '申请续期',
        actionUrl: VERIFY_URL,
      }
    : {
        variant,
        badge: '尚未成为会员',
        hint: '验证学生邮箱并提交申请，人工审核通过后才能领取和使用电子会员卡。',
        action: '申请会员',
        actionUrl: VERIFY_URL,
      }
}

export function memberEntry(me: Me | null): MemberEntry {
  const membership = me?.membership
  const application = membership?.application
  if (membership?.state === 'revoked') {
    return {
      title: '会员资格已取消',
      description: '如有疑问，请联系学生会',
      action: '查看详情',
      url: CARD_URL,
    }
  }
  if (membership?.state === 'active') {
    const expiry = membership.expires_at ? formatDate(membership.expires_at) : ''
    const hint =
      application?.status === 'pending'
        ? ' · 续期审核中'
        : membership.renewable
          ? ' · 即将到期，可申请续期'
          : ''
    return {
      title: '我的会员卡',
      description: `会员编号 ${membership.member_no ?? ''} · 有效期至 ${expiry}${hint}`,
      action: '出示会员卡',
      url: CARD_URL,
    }
  }
  if (application?.status === 'pending') {
    return {
      title: '会员申请审核中',
      description: '审核通过后可使用会员卡、发帖和评论',
      action: '查看状态',
      url: VERIFY_URL,
    }
  }
  if (application?.status === 'rejected') {
    return {
      title: '会员申请未通过',
      description: application.review_note || '查看审核意见后可重新申请',
      action: '重新申请',
      url: VERIFY_URL,
    }
  }
  if (membership?.state === 'expired') {
    return {
      title: '会员已过期',
      description: '提交续期申请，人工审核通过后恢复资格',
      action: '申请续期',
      url: VERIFY_URL,
    }
  }
  return {
    title: '申请会员',
    description: '验证 Monash 学生邮箱，人工审核通过后享受会员权益',
    action: '去申请',
    url: VERIFY_URL,
  }
}
