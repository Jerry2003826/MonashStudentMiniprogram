import { request } from '../request'

// 只在管理员明确点击确认后调用，不能在加载页面或输入验证码时自动授权。
export async function confirmStaffLogin(code: string): Promise<void> {
  await request<unknown>({ method: 'POST', path: '/staff/login/confirm', body: { code } })
}
