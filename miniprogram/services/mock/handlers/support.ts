import {
  FEEDBACK_CONTACT_MAX_LENGTH,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  type FeedbackBody,
  type FeedbackCategory,
  type FeedbackResult,
  type SupportContent,
} from '../../../types/support'
import { mockError, readString } from '../helpers'
import type { MockRequest, MockRoute } from '../router'

const supportContent: SupportContent = {
  handbook: [
    {
      id: 1,
      title: '出发前的准备',
      content:
        '示例章节：这里将整理行前准备、常用材料和学校官方信息入口。正式清单由学生会审核后发布；当前内容不作为入境、住宿或入学指引。',
    },
    {
      id: 2,
      title: '认识校园与学生服务',
      content:
        '示例章节：这里将介绍校园、学生支持和迎新信息。校区、开放时间和服务联系方式尚待确认，请以学校发布的最新信息为准。',
    },
    {
      id: 3,
      title: '生活与学生会活动',
      content:
        '示例章节：这里将整理生活资源、学生会活动和合作商家入口。正式内容与联系方式尚待学生会提供，当前示例没有对外服务承诺。',
    },
  ],
  website_url: null,
  assistant_wechat: null,
}

const categories: readonly string[] = ['suggestion', 'bug', 'merchant']
const feedbackRecords: Array<FeedbackBody & FeedbackResult> = []

export function resetSupportMock(): void {
  feedbackRecords.length = 0
}

function getSupport(): SupportContent {
  return { ...supportContent, handbook: supportContent.handbook.map((section) => ({ ...section })) }
}

function createFeedback({ body }: MockRequest): FeedbackResult {
  const category = readString(body, 'category')
  const content = readString(body, 'content').trim()
  const rawContact =
    body && typeof body === 'object' ? (body as Record<string, unknown>).contact : undefined
  if (!categories.includes(category)) throw mockError('VALIDATION_ERROR', '请选择反馈类型')
  if (content.length < FEEDBACK_MIN_LENGTH || content.length > FEEDBACK_MAX_LENGTH) {
    throw mockError(
      'VALIDATION_ERROR',
      `请填写 ${FEEDBACK_MIN_LENGTH}–${FEEDBACK_MAX_LENGTH} 字的反馈`,
    )
  }
  if (
    rawContact !== undefined &&
    (typeof rawContact !== 'string' || rawContact.trim().length > FEEDBACK_CONTACT_MAX_LENGTH)
  ) {
    throw mockError('VALIDATION_ERROR', `联系方式不能超过 ${FEEDBACK_CONTACT_MAX_LENGTH} 字`)
  }
  const contact = typeof rawContact === 'string' ? rawContact.trim() : ''
  const id = feedbackRecords.length + 1
  feedbackRecords.push({
    id,
    category: category as FeedbackCategory,
    content,
    ...(contact ? { contact } : {}),
  })
  return { id }
}

export const supportRoutes: MockRoute[] = [
  { method: 'GET', pattern: '/support', handler: getSupport },
  { method: 'POST', pattern: '/feedback', handler: createFeedback },
]
