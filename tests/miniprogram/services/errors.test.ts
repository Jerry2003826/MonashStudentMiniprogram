import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  defaultMessage,
  isApiError,
  showError,
} from '../../../miniprogram/services/errors'
import { API_ERROR_CODES } from '../../../miniprogram/types/api'

describe('defaultMessage', () => {
  it('每个错误码都有提示文案', () => {
    for (const code of [...API_ERROR_CODES, 'NETWORK_ERROR'] as const) {
      expect(defaultMessage(code)).not.toBe('')
    }
  })
})

describe('ApiError', () => {
  it('保留错误码、状态码和提示文字', () => {
    const err = new ApiError('CODE_INVALID', '验证码错误', 422)

    expect(isApiError(err)).toBe(true)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('CODE_INVALID')
    expect(err.status).toBe(422)
    expect(err.message).toBe('验证码错误')
  })

  it('普通错误和空值不是 ApiError', () => {
    expect(isApiError(new Error('x'))).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})

describe('showError', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ApiError 显示它自己的提示文字', () => {
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })

    showError(new ApiError('RATE_LIMITED', '操作太频繁'))

    expect(showToast).toHaveBeenCalledWith({ title: '操作太频繁', icon: 'none' })
  })

  it('ApiError 没有提示文字时用错误码的默认文案', () => {
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })

    showError(new ApiError('NETWORK_ERROR', ''))

    expect(showToast).toHaveBeenCalledWith({ title: defaultMessage('NETWORK_ERROR'), icon: 'none' })
  })

  it('其他错误显示通用文案', () => {
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })

    showError(new Error('boom'))

    expect(showToast).toHaveBeenCalledWith({ title: '出了点问题，请稍后再试', icon: 'none' })
  })
})
