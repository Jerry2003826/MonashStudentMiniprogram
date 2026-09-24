import { ApiError } from '../errors'
import type { HttpMethod, Query } from '../http'

export interface MockRequest {
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}

export type MockHandler = (req: MockRequest) => unknown

export interface MockRoute {
  method: HttpMethod
  pattern: string
  handler: MockHandler
}

export interface RouteMatch {
  route: MockRoute
  params: Record<string, string>
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function matchRoute(
  routes: MockRoute[],
  method: HttpMethod,
  path: string,
): RouteMatch | null {
  const segments = splitPath(path)
  for (const route of routes) {
    if (route.method !== method) continue
    const patternSegments = splitPath(route.pattern)
    if (patternSegments.length !== segments.length) continue

    const params: Record<string, string> = {}
    const matched = patternSegments.every((segment, index) => {
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(segments[index])
        return true
      }
      return segment === segments[index]
    })
    if (matched) return { route, params }
  }
  return null
}

function normalizeQuery(query?: Query): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) result[key] = String(value)
  }
  return result
}

export function resolveMock(
  routes: MockRoute[],
  method: HttpMethod,
  path: string,
  query?: Query,
  body?: unknown,
): unknown {
  const match = matchRoute(routes, method, path)
  if (!match) {
    throw new ApiError('NOT_FOUND', `假接口不存在：${method} ${path}`, 404)
  }
  return match.route.handler({ params: match.params, query: normalizeQuery(query), body })
}
