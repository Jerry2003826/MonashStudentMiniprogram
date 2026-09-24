import { fetchMe, getCachedMe, isActiveMember } from '../services/auth'
import { VERIFY_URL } from './membership'

// 发帖、评论、点赞、举报前调用；不是有效会员时弹窗引导去认证
export async function ensureMember(action: string): Promise<boolean> {
  const me = getCachedMe() ?? (await fetchMe())
  if (isActiveMember(me)) return true
  const { confirm } = await wx.showModal({
    title: '需要学生认证',
    content: `${action}需要先完成 Monash 学生认证，认证免费，只需要验证学生邮箱。`,
    confirmText: '去认证',
  })
  if (confirm) wx.navigateTo({ url: VERIFY_URL })
  return false
}
