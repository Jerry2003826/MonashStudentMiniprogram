import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../miniprogram/services/errors'
import {
  buildUrl,
  request,
  setUnauthorizedHandler,
  uploadFile,
} from '../../../miniprogram/services/request'
import { installFakeWx } from '../helpers/wx'

const config = vi.hoisted(() => ({ mock: false }))

vi.mock('../../../miniprogram/config', () => ({
  MOCK_DELAY_MS: 0,
  getDevelopmentLoginUsername: () => null,
  isMockEnabled: () => config.mock,
  getApiBaseUrl: () => 'https://api.test/api/v1',
}))

vi.mock('../../../miniprogram/services/mock/routes', () => ({
  mockRoutes: [
    { method: 'GET', pattern: '/ping', handler: () => ({ pong: true }) },
    {
      method: 'POST',
      pattern: '/uploads',
      handler: ({ body }: { body: unknown }) => ({ received: body }),
    },
  ],
}))

let fake: ReturnType<typeof installFakeWx>

beforeEach(() => {
  config.mock = false
  fake = installFakeWx()
  setUnauthorizedHandler(async () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (err) {
    return err as ApiError
  }
  throw new Error('期望抛出错误，但请求成功了')
}

describe('buildUrl', () => {
  it('拼接查询参数，并丢掉值为 undefined 的参数', () => {
    expect(
      buildUrl('https://a.com/api/v1', '/merchants', { q: '奶茶', area: 2, category: undefined }),
    ).toBe('https://a.com/api/v1/merchants?q=%E5%A5%B6%E8%8C%B6&area=2')
  })

  it('没有查询参数时不带问号', () => {
    expect(buildUrl('https://a.com/api/v1', '/me')).toBe('https://a.com/api/v1/me')
  })
})

describe('request', () => {
  it('读取保留15秒，写入等待30秒且网络失败不会自动重放', async () => {
    fake.respondWith(() => ({ statusCode: 200, data: {} }))
    await request({ method: 'GET', path: '/home', auth: false })
    expect(fake.request.mock.calls[0][0].timeout).toBe(15000)
    fake.respondWith(() => 'fail')
    const err = await captureError(request({ method: 'POST', path: '/forum/posts' }))
    expect(fake.request.mock.calls[1][0].timeout).toBe(30000)
    expect(err.message).toContain('先刷新查看')
    expect(fake.request).toHaveBeenCalledTimes(2)
  })

  it('写入401刷新登录后需用户确认重试，不自动重放POST', async () => {
    const relogin = vi.fn(async () => {})
    setUnauthorizedHandler(relogin)
    fake.respondWith(() => ({ statusCode: 401, data: { code: 'UNAUTHORIZED', message: '过期' } }))
    const err = await captureError(request({ method: 'POST', path: '/forum/posts' }))
    expect(relogin).toHaveBeenCalledOnce()
    expect(fake.request).toHaveBeenCalledOnce()
    expect(err.message).toContain('再次提交')
  })
  it('有 token 时带上 Authorization 头', async () => {
    fake.storage.set('auth_token', 'abc')
    fake.respondWith(() => ({ statusCode: 200, data: { ok: true } }))

    await request({ method: 'GET', path: '/me' })

    expect(fake.request.mock.calls[0][0].header?.Authorization).toBe('Bearer abc')
  })

  it('auth 为 false 时不带 Authorization 头', async () => {
    fake.storage.set('auth_token', 'abc')
    fake.respondWith(() => ({ statusCode: 200, data: {} }))

    await request({ method: 'POST', path: '/auth/wechat-login', auth: false })

    expect(fake.request.mock.calls[0][0].header?.Authorization).toBeUndefined()
  })

  it('状态码 2xx 时返回响应体', async () => {
    fake.respondWith(() => ({ statusCode: 200, data: { id: 1 } }))

    await expect(request({ method: 'GET', path: '/merchants/1' })).resolves.toEqual({ id: 1 })
  })

  it('响应体是合法的错误格式时，抛出对应的 ApiError', async () => {
    fake.respondWith(() => ({
      statusCode: 403,
      data: { code: 'MEMBERSHIP_REQUIRED', message: '请先完成学生认证' },
    }))

    const err = await captureError(request({ method: 'POST', path: '/forum/posts' }))

    expect(err.code).toBe('MEMBERSHIP_REQUIRED')
    expect(err.status).toBe(403)
    expect(err.message).toBe('请先完成学生认证')
  })

  it('响应体不是合法的错误格式时，抛出 INTERNAL_ERROR', async () => {
    fake.respondWith(() => ({ statusCode: 502, data: '<html>Bad Gateway</html>' }))

    const err = await captureError(request({ method: 'GET', path: '/home' }))

    expect(err.code).toBe('INTERNAL_ERROR')
    expect(err.status).toBe(502)
  })

  it('网络失败时抛出 NETWORK_ERROR', async () => {
    fake.respondWith(() => 'fail')

    const err = await captureError(request({ method: 'GET', path: '/home' }))

    expect(err.code).toBe('NETWORK_ERROR')
  })

  it('收到 UNAUTHORIZED 时重新登录并重试一次', async () => {
    const relogin = vi.fn(async () => {
      fake.storage.set('auth_token', 'new-token')
    })
    setUnauthorizedHandler(relogin)
    fake.respondWith((options) =>
      options.header?.Authorization === 'Bearer new-token'
        ? { statusCode: 200, data: { ok: true } }
        : { statusCode: 401, data: { code: 'UNAUTHORIZED', message: '登录已失效' } },
    )

    await expect(request({ method: 'GET', path: '/me' })).resolves.toEqual({ ok: true })
    expect(relogin).toHaveBeenCalledTimes(1)
    expect(fake.request).toHaveBeenCalledTimes(2)
  })

  it('重试后仍然是 UNAUTHORIZED 时抛错，不会无限重试', async () => {
    const relogin = vi.fn(async () => {})
    setUnauthorizedHandler(relogin)
    fake.respondWith(() => ({
      statusCode: 401,
      data: { code: 'UNAUTHORIZED', message: '登录已失效' },
    }))

    const err = await captureError(request({ method: 'GET', path: '/me' }))

    expect(err.code).toBe('UNAUTHORIZED')
    expect(relogin).toHaveBeenCalledTimes(1)
    expect(fake.request).toHaveBeenCalledTimes(2)
  })

  it('假数据模式下不发网络请求，直接返回假接口的结果', async () => {
    config.mock = true

    await expect(request({ method: 'GET', path: '/ping' })).resolves.toEqual({ pong: true })
    expect(fake.request).not.toHaveBeenCalled()
  })
})

describe('uploadFile', () => {
  it('解析上传接口返回的 JSON 字符串', async () => {
    fake.respondWith(() => ({ statusCode: 200, data: { id: 7 } }))

    await expect(uploadFile('/forum/images', 'wxfile://tmp.jpg')).resolves.toEqual({ id: 7 })
    expect(fake.uploadFile.mock.calls[0][0].name).toBe('file')
  })

  it('假数据模式下把本地文件路径交给假接口', async () => {
    config.mock = true

    await expect(uploadFile('/uploads', 'wxfile://tmp.jpg')).resolves.toEqual({
      received: { file_path: 'wxfile://tmp.jpg' },
    })
    expect(fake.uploadFile).not.toHaveBeenCalled()
  })
})
