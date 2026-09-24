import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../miniprogram/services/errors'
import { matchRoute, resolveMock, type MockRoute } from '../../../miniprogram/services/mock/router'

const detail = vi.fn(() => 'detail')
const list = vi.fn(() => 'list')

const routes: MockRoute[] = [
  { method: 'GET', pattern: '/merchants', handler: list },
  { method: 'GET', pattern: '/merchants/:id', handler: detail },
]

describe('matchRoute', () => {
  it('匹配路径参数', () => {
    const match = matchRoute(routes, 'GET', '/merchants/12')

    expect(match?.route.handler).toBe(detail)
    expect(match?.params).toEqual({ id: '12' })
  })

  it('方法不同不匹配', () => {
    expect(matchRoute(routes, 'POST', '/merchants/12')).toBeNull()
  })

  it('段数不同不匹配', () => {
    expect(matchRoute(routes, 'GET', '/merchants/12/images')).toBeNull()
  })
})

describe('resolveMock', () => {
  it('找不到路由时抛出 NOT_FOUND', () => {
    expect(() => resolveMock(routes, 'GET', '/unknown')).toThrow(ApiError)

    try {
      resolveMock(routes, 'GET', '/unknown')
    } catch (err) {
      expect((err as ApiError).code).toBe('NOT_FOUND')
    }
  })

  it('丢掉值为 undefined 的查询参数，其余转成字符串，并传入请求体', () => {
    const handler = vi.fn(() => 'ok')
    const withHandler: MockRoute[] = [{ method: 'POST', pattern: '/posts', handler }]

    const result = resolveMock(
      withHandler,
      'POST',
      '/posts',
      { board: 3, q: '二手', cursor: undefined },
      {
        title: '标题',
      },
    )

    expect(result).toBe('ok')
    expect(handler).toHaveBeenCalledWith({
      params: {},
      query: { board: '3', q: '二手' },
      body: { title: '标题' },
    })
  })
})
