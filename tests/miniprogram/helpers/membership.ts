import { getDb } from '../../../miniprogram/services/mock/db'
import type { Me, MembershipInfo, StaffRole } from '../../../miniprogram/types/api'

export function makeMe(
  membership: Partial<MembershipInfo> = {},
  staffRole: StaffRole | null = null,
): Me {
  return {
    id: 1,
    nickname: '测试同学',
    avatar_url: null,
    banned_until: null,
    staff_role: staffRole,
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

// 仅测试可调用的受控后台审核 fixture；小程序和 mock 路由不暴露任何批准入口。
export function approveMockApplication(): void {
  const db = getDb()
  const application = db.application
  if (!application || application.status !== 'pending') throw new Error('需要待审核申请')
  const previousExpiry = db.membership ? Date.parse(db.membership.expires_at) : 0
  db.membership = {
    email: application.email,
    member_no: db.membership?.member_no ?? '000123',
    expires_at: new Date(
      Math.max(Date.now(), previousExpiry) + 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    revoked: false,
  }
  db.membershipEmailOwners[application.email] = db.meId
  application.status = 'approved'
  application.reviewed_at = new Date().toISOString()
  application.review_note = ''
}

export function rejectMockApplication(note = '请补充在读学生信息'): void {
  const application = getDb().application
  if (!application || application.status !== 'pending') throw new Error('需要待审核申请')
  application.status = 'rejected'
  application.reviewed_at = new Date().toISOString()
  application.review_note = note
}
