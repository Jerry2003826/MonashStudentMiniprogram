import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetSupportMock,
  supportRoutes,
} from '../../../../miniprogram/services/mock/handlers/support'
import { resolveMock } from '../../../../miniprogram/services/mock/router'
import type { FeedbackResult, SupportContent } from '../../../../miniprogram/types/support'
import { errorCodeOf } from './call'

function send(body: unknown): FeedbackResult {
  return resolveMock(supportRoutes, 'POST', '/feedback', undefined, body) as FeedbackResult
}

beforeEach(resetSupportMock)

describe('手册和联系方式', () => {
  it('缺失的官方联系方式返回 null，手册明确标记示例', () => {
    const content = resolveMock(supportRoutes, 'GET', '/support') as SupportContent
    expect(content.assistant_wechat).toBeNull()
    expect(content.website_url).toBeNull()
    expect(content.handbook.length).toBeGreaterThan(0)
    expect(content.handbook.every((section) => section.content.includes('示例章节'))).toBe(true)
  })

  it('调用方修改返回内容不会污染后续请求', () => {
    const first = resolveMock(supportRoutes, 'GET', '/support') as SupportContent
    first.handbook[0].title = '已被修改'
    const second = resolveMock(supportRoutes, 'GET', '/support') as SupportContent
    expect(second.handbook[0].title).not.toBe('已被修改')
  })
})

describe('反馈演示', () => {
  it('有效反馈产生独立编号，允许省略联系方式', () => {
    expect(send({ category: 'suggestion', content: '希望增加更多新生手册的内容。' })).toEqual({
      id: 1,
    })
    expect(
      send({ category: 'merchant', content: '这家商店的营业时间似乎不准确。', contact: 'demo' }),
    ).toEqual({ id: 2 })
  })

  it.each([
    null,
    { category: 'other', content: '这是一条用于测试的完整反馈。' },
    { category: 'bug', content: '字数不够' },
    { category: 'bug', content: '          ' },
    { category: 'bug', content: 12345 },
    { category: 'bug', content: '字'.repeat(1001) },
    { category: 'bug', content: '这是一条用于测试的完整反馈。', contact: 'x'.repeat(101) },
    { category: 'bug', content: '这是一条用于测试的完整反馈。', contact: 12345 },
  ])('拒绝无效输入且不会消耗反馈编号：%j', (body) => {
    expect(errorCodeOf(() => send(body))).toBe('VALIDATION_ERROR')
    expect(send({ category: 'bug', content: '这是一条用于测试的完整反馈。' })).toEqual({ id: 1 })
  })

  it('按去除首尾空白后的内容验证长度，接受两个长度边界', () => {
    expect(send({ category: 'bug', content: `  ${'字'.repeat(10)}  ` })).toEqual({ id: 1 })
    expect(send({ category: 'bug', content: '字'.repeat(1000), contact: '' })).toEqual({ id: 2 })
  })

  it('重置运行后清空演示反馈', () => {
    send({ category: 'bug', content: '这是一条用于测试的完整反馈。' })
    resetSupportMock()
    expect(send({ category: 'bug', content: '这是一条用于测试的完整反馈。' })).toEqual({ id: 1 })
  })
})
