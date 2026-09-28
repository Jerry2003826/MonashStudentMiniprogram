import { fetchMe, isActiveMember } from '../services/auth'
import { VERIFY_URL } from './membership'

// 重新读取状态，确保人工审核结果与过期状态及时生效；服务端仍必须校验权限。
export async function ensureMember(action: string): Promise<boolean> {
  const me = await fetchMe()
  if (isActiveMember(me)) return true
  const { confirm } = await wx.showModal({
    title: me.membership.application?.status === 'pending' ? '会员申请审核中' : '需要有效会员资格',
    content: `${action}需要有效会员资格。验证学生邮箱并提交申请后，还需由学生会人工审核通过。`,
    confirmText: '查看申请',
  })
  if (confirm) wx.navigateTo({ url: VERIFY_URL })
  return false
}
