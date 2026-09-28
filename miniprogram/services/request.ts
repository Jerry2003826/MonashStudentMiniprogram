import { getApiBaseUrl, isMockEnabled, MOCK_DELAY_MS } from '../config'
import { API_ERROR_CODES, type ErrorBody } from '../types/api'
import { ApiError, defaultMessage } from './errors'
import type { HttpMethod, Query } from './http'
import { resolveMock } from './mock/router'
import { mockRoutes } from './mock/routes'
import { getToken } from './token'

export type { HttpMethod, Query } from './http'

export interface RequestOptions {
  method: HttpMethod
  path: string
  query?: Query
  body?: unknown
  auth?: boolean
}

const READ_TIMEOUT_MS = 15000
const WRITE_TIMEOUT_MS = 30000

let unauthorizedHandler: () => Promise<void> = async () => {}

export function setUnauthorizedHandler(handler: () => Promise<void>): void {
  unauthorizedHandler = handler
}

export function buildUrl(base: string, path: string, query?: Query): string {
  const search = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return search ? `${base}${path}?${search}` : `${base}${path}`
}

function isErrorBody(data: unknown): data is ErrorBody {
  if (typeof data !== 'object' || data === null) return false
  const { code, message } = data as Record<string, unknown>
  return typeof message === 'string' && (API_ERROR_CODES as readonly unknown[]).includes(code)
}

function toApiError(statusCode: number, data: unknown): ApiError {
  if (isErrorBody(data)) {
    return new ApiError(data.code, data.message || defaultMessage(data.code), statusCode)
  }
  return new ApiError('INTERNAL_ERROR', defaultMessage('INTERNAL_ERROR'), statusCode)
}

function networkError(writing = false): ApiError {
  return new ApiError(
    'NETWORK_ERROR',
    writing ? '未能确认提交结果，请先刷新查看再决定是否重试' : defaultMessage('NETWORK_ERROR'),
  )
}

function authHeader(auth: boolean): Record<string, string> {
  const token = auth ? getToken() : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300
}

async function mockRequest<T>(
  method: HttpMethod,
  path: string,
  query?: Query,
  body?: unknown,
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS))
  return resolveMock(mockRoutes, method, path, query, body) as T
}

async function withReauth<T>(
  send: () => Promise<T>,
  auth: boolean,
  canReplay: boolean,
): Promise<T> {
  try {
    return await send()
  } catch (err) {
    if (!auth || !(err instanceof ApiError) || err.code !== 'UNAUTHORIZED') throw err
    await unauthorizedHandler()
    if (!canReplay) throw new ApiError('UNAUTHORIZED', '登录已更新，请确认内容后再次提交', 401)
    return send()
  }
}

function sendRequest<T>({ method, path, query, body, auth = true }: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: buildUrl(getApiBaseUrl(), path, query),
      method,
      data: body as WechatMiniprogram.IAnyObject | undefined,
      header: { 'Content-Type': 'application/json', ...authHeader(auth) },
      timeout: method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS,
      success: (res) => {
        if (isSuccess(res.statusCode)) resolve(res.data as T)
        else reject(toApiError(res.statusCode, res.data))
      },
      fail: () => reject(networkError(method !== 'GET')),
    })
  })
}

function sendUpload<T>(path: string, filePath: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.uploadFile({
      url: buildUrl(getApiBaseUrl(), path),
      filePath,
      name: 'file',
      header: authHeader(true),
      timeout: WRITE_TIMEOUT_MS,
      success: (res) => {
        const data = parseJson(res.data)
        if (isSuccess(res.statusCode)) resolve(data as T)
        else reject(toApiError(res.statusCode, data))
      },
      fail: () => reject(networkError(true)),
    })
  })
}

export function request<T>(options: RequestOptions): Promise<T> {
  if (isMockEnabled()) {
    return mockRequest<T>(options.method, options.path, options.query, options.body)
  }
  return withReauth(() => sendRequest<T>(options), options.auth ?? true, options.method === 'GET')
}

export function uploadFile<T>(path: string, filePath: string): Promise<T> {
  if (isMockEnabled()) {
    return mockRequest<T>('POST', path, undefined, { file_path: filePath })
  }
  return withReauth(() => sendUpload<T>(path, filePath), true, false)
}
