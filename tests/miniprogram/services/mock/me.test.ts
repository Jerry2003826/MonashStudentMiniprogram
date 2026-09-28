import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../../../miniprogram/services/mock/db'
import type { LoginResult, Me } from '../../../../miniprogram/types/api'
import { call, errorCodeOf } from './call'

beforeEach(() => {
  resetDb()
})

describe('登录', () => {
  it('返回 token 和未认证的当前用户', () => {
    const result = call<LoginResult>('POST', '/auth/wechat-login', { code: 'x' })

    expect(result.token).not.toBe('')
    expect(result.me.nickname).toBe('微信用户')
    expect(result.me.membership.state).toBe('none')
  })
})

describe('修改昵称', () => {
  it('合法昵称会被保存', () => {
    call('PUT', '/me', { nickname: '  小蒙  ' })

    expect(call<Me>('GET', '/me').nickname).toBe('小蒙')
  })

  it('昵称为空或超过 20 个字时失败', () => {
    expect(errorCodeOf(() => call('PUT', '/me', { nickname: '   ' }))).toBe('VALIDATION_ERROR')
    expect(errorCodeOf(() => call('PUT', '/me', { nickname: '字'.repeat(21) }))).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('含违规内容时失败', () => {
    expect(errorCodeOf(() => call('PUT', '/me', { nickname: '违规昵称' }))).toBe('CONTENT_RISKY')
  })
})

describe('上传头像', () => {
  it('把本地文件路径当作头像地址', () => {
    const me = call<Me>('POST', '/me/avatar', { file_path: 'wxfile://avatar.jpg' })

    expect(me.avatar_url).toBe('wxfile://avatar.jpg')
  })
})

describe('注销账号', () => {
  it('之后的当前用户是一个全新的未认证用户', () => {
    call('POST', '/membership/email-code', { email: 'a@student.monash.edu' })
    call('POST', '/membership/applications', { email: 'a@student.monash.edu', code: '123456' })
    call('PUT', '/me', { nickname: '小蒙' })
    const before = call<Me>('GET', '/me')

    call('DELETE', '/me')
    const after = call<Me>('GET', '/me')

    expect(after.id).not.toBe(before.id)
    expect(after.nickname).toBe('微信用户')
    expect(after.membership.state).toBe('none')
    expect(after.membership.application).toBeNull()
    expect(after.staff_role).toBeNull()
  })
})
