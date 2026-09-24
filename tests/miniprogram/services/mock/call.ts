import type { ApiError } from '../../../../miniprogram/services/errors'
import type { HttpMethod, Query } from '../../../../miniprogram/services/http'
import { resolveMock } from '../../../../miniprogram/services/mock/router'
import { mockRoutes } from '../../../../miniprogram/services/mock/routes'

export function call<T>(method: HttpMethod, path: string, body?: unknown, query?: Query): T {
  return resolveMock(mockRoutes, method, path, query, body) as T
}

export function errorCodeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as ApiError).code
  }
  throw new Error('期望抛出错误，但调用成功了')
}
