import type { ApiErrorCode } from '../types/api'

export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR'

export class ApiError extends Error {
  readonly code: ClientErrorCode
  readonly status: number

  constructor(code: ClientErrorCode, message: string, status = 0) {
    super(message)
    // 开发者工具把代码编译成 ES5 后，继承 Error 的类会丢失原型链，instanceof 会失效
    Object.setPrototypeOf(this, ApiError.prototype)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

export function defaultMessage(code: ClientErrorCode): string {
  switch (code) {
    case 'UNAUTHORIZED':
      return '登录已失效，请重新打开小程序'
    case 'FORBIDDEN':
      return '没有权限进行这个操作'
    case 'MEMBERSHIP_REQUIRED':
      return '需要有效会员资格，请提交申请并等待人工审核通过'
    case 'USER_BANNED':
      return '你已被禁言，暂时不能发帖和评论'
    case 'NOT_FOUND':
      return '内容不存在或已被删除'
    case 'ALREADY_MEMBER':
      return '邮箱或微信账号已存在会员绑定，请联系学生会处理'
    case 'RENEWAL_NOT_OPEN':
      return '到期前 30 天内才能续期'
    case 'MEMBERSHIP_REVOKED':
      return '会员资格已被取消，请联系学生会'
    case 'VALIDATION_ERROR':
      return '填写的内容有误，请检查后再试'
    case 'EMAIL_DOMAIN_NOT_ALLOWED':
      return '请使用当前允许的学生邮箱域名'
    case 'CODE_INVALID':
      return '验证码错误或已过期'
    case 'CONTENT_RISKY':
      return '内容可能含有违规信息，请修改后再发布'
    case 'RATE_LIMITED':
      return '操作太频繁，请稍后再试'
    case 'INTERNAL_ERROR':
      return '服务器开小差了，请稍后再试'
    case 'NETWORK_ERROR':
      return '网络不太好，请稍后再试'
    default: {
      const unreachable: never = code
      return unreachable
    }
  }
}

const FALLBACK_MESSAGE = '出了点问题，请稍后再试'

export function showError(err: unknown): void {
  const title = isApiError(err) ? err.message || defaultMessage(err.code) : FALLBACK_MESSAGE
  wx.showToast({ title, icon: 'none' })
}
