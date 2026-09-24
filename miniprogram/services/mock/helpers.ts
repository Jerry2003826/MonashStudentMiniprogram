import type { ApiErrorCode, Paginated } from '../../types/api'
import { ApiError, defaultMessage } from '../errors'

export const RISKY_WORD = '违规'

function httpStatusOf(code: ApiErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
    case 'MEMBERSHIP_REQUIRED':
    case 'USER_BANNED':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'ALREADY_MEMBER':
    case 'RENEWAL_NOT_OPEN':
    case 'MEMBERSHIP_REVOKED':
      return 409
    case 'VALIDATION_ERROR':
    case 'EMAIL_DOMAIN_NOT_ALLOWED':
    case 'CODE_INVALID':
    case 'CONTENT_RISKY':
      return 422
    case 'RATE_LIMITED':
      return 429
    case 'INTERNAL_ERROR':
      return 500
    default: {
      const unreachable: never = code
      return unreachable
    }
  }
}

export function mockError(code: ApiErrorCode, message: string = defaultMessage(code)): ApiError {
  return new ApiError(code, message, httpStatusOf(code))
}

export function assertSafe(...texts: string[]): void {
  if (texts.some((text) => text.includes(RISKY_WORD))) {
    throw mockError('CONTENT_RISKY')
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

export function readString(body: unknown, key: string): string {
  const value = asRecord(body)[key]
  return typeof value === 'string' ? value : ''
}

export function readNumber(body: unknown, key: string): number | undefined {
  const value = asRecord(body)[key]
  return typeof value === 'number' ? value : undefined
}

export function readNumberArray(body: unknown, key: string): number[] {
  const value = asRecord(body)[key]
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : []
}

export function queryNumber(query: Record<string, string>, key: string): number | undefined {
  const value = query[key]
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function paramNumber(params: Record<string, string>, key: string): number {
  const parsed = Number(params[key])
  if (!Number.isInteger(parsed)) throw mockError('NOT_FOUND')
  return parsed
}

export function includesText(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.trim().toLowerCase())
}

export function paginate<T>(
  items: T[],
  cursor: string | undefined,
  pageSize: number,
): Paginated<T> {
  const offset = cursor ? Number(cursor) || 0 : 0
  const next = offset + pageSize
  return {
    items: items.slice(offset, next),
    next_cursor: next < items.length ? String(next) : null,
  }
}
