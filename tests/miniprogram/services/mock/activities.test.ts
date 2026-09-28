import { describe, expect, it } from 'vitest'
import { activityRoutes } from '../../../../miniprogram/services/mock/handlers/activities'
import { resolveMock } from '../../../../miniprogram/services/mock/router'
import type { ActivityDetail, ActivitySummary } from '../../../../miniprogram/types/activities'
import type { Paginated } from '../../../../miniprogram/types/api'
import { errorCodeOf } from './call'

function list(query: Record<string, string> = {}): Paginated<ActivitySummary> {
  return resolveMock(activityRoutes, 'GET', '/activities', query) as Paginated<ActivitySummary>
}

describe('活动内容接口', () => {
  it('三个分类各有前三项内容，分类筛选不会混入其他分类', () => {
    for (const category of ['latest', 'news', 'past']) {
      const result = list({ category })
      expect(result.items.length).toBeGreaterThanOrEqual(3)
      expect(result.items.every((item) => item.category === category)).toBe(true)
    }
  })

  it('搜索与分类同时生效，按标题和摘要匹配', () => {
    expect(list({ category: 'latest', q: '校园' }).items.map((item) => item.id)).toEqual([1])
    expect(list({ category: 'past', q: '校园' }).items.map((item) => item.id)).toEqual([9])
    expect(list({ category: 'latest', q: '新朋友' }).items.map((item) => item.id)).toEqual([1, 3])
  })

  it('分页不会重复或漏掉示例记录，空结果正常结束', () => {
    const first = list()
    const second = list({ cursor: first.next_cursor! })
    expect(first.items).toHaveLength(6)
    expect(second.items).toHaveLength(4)
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(10)
    expect(second.next_cursor).toBeNull()
    expect(list({ q: '没有这条活动' })).toEqual({ items: [], next_cursor: null })
  })

  it('拒绝无效分类和无效分页位置', () => {
    expect(errorCodeOf(() => list({ category: 'invalid' }))).toBe('VALIDATION_ERROR')
    expect(errorCodeOf(() => list({ cursor: '-1' }))).toBe('VALIDATION_ERROR')
    expect(errorCodeOf(() => list({ cursor: '1.5' }))).toBe('VALIDATION_ERROR')
  })

  it('示例标识贯穿详情，不捏造原文链接和活动时间', () => {
    const detail = resolveMock(activityRoutes, 'GET', '/activities/1') as ActivityDetail
    expect(detail.is_example).toBe(true)
    expect(detail.article_url).toBeNull()
    expect(detail.starts_at).toBeNull()
    expect(detail.content).toContain('示例')
    detail.title = 'changed'
    expect((resolveMock(activityRoutes, 'GET', '/activities/1') as ActivityDetail).title).not.toBe(
      'changed',
    )
  })

  it('不存在和错误格式的详情链接返回可展示的 NOT_FOUND', () => {
    for (const id of ['999', 'NaN', '1.5', '-1']) {
      expect(errorCodeOf(() => resolveMock(activityRoutes, 'GET', `/activities/${id}`))).toBe(
        'NOT_FOUND',
      )
    }
  })
})
