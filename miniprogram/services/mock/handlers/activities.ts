import type { ActivityDetail, ActivitySummary } from '../../../types/activities'
import type { Paginated } from '../../../types/api'
import { includesText, mockError, paginate, paramNumber } from '../helpers'
import type { MockRequest, MockRoute } from '../router'

// 只用于开发预览；正式活动、时间地点和公众号原文均须由学生会提供。
const activities: ActivityDetail[] = [
  {
    id: 1,
    category: 'latest',
    title: '校园迎新见面会',
    summary: '认识新朋友、了解校园生活的活动版式示例。',
    content:
      '这里将介绍迎新活动的安排、参加方式和注意事项。\n\n当前为示例内容，仅用于预览页面，不代表已发布的活动，也不开放报名。正式时间、地点和公众号文章由学生会确认后发布。',
  },
  {
    id: 2,
    category: 'latest',
    title: '周末城市探索',
    summary: '一起探索墨尔本的活动版式示例。',
    content:
      '这里将介绍集合地点、活动路线、参与条件与天气调整安排。\n\n这是一条示例内容，请勿据此安排行程。正式安排以学生会发布的公众号原文为准。',
  },
  {
    id: 3,
    category: 'latest',
    title: '社团交流之夜',
    summary: '社团交流与新朋友见面的活动版式示例。',
    content:
      '这里将介绍参与社团、活动流程及报名渠道。\n\n当前仅展示活动页面效果，尚未配置真实活动和报名链接。',
  },
  {
    id: 4,
    category: 'latest',
    title: '学习经验分享会',
    summary: '学长学姐经验交流的活动版式示例。',
    content:
      '这里将介绍分享主题、嘉宾、参加方式与活动时间。\n\n这是一条示例内容，不代表已确认的分享会。请等待学生会发布正式安排。',
  },
  {
    id: 5,
    category: 'news',
    title: '新学期校园资讯',
    summary: '校园服务与新学期资讯的内容版式示例。',
    content:
      '这里将整理校园服务和新学期相关资讯，并附上信息来源及更新时间。\n\n当前内容仅用于预览，尚未发布真实通知。',
  },
  {
    id: 6,
    category: 'news',
    title: '学生会服务介绍',
    summary: '了解学生会服务入口的资讯版式示例。',
    content:
      '这里将介绍学生会可以提供的帮助与联系渠道。\n\n正式服务范围、联系方式和公众号原文待学生会确认。',
  },
  {
    id: 7,
    category: 'news',
    title: '墨尔本生活资讯',
    summary: '生活信息与实用链接的内容版式示例。',
    content:
      '这里将整理生活资讯和官方信息来源。\n\n当前没有已核实的新闻或通知，请勿将示例内容作为出行或办事依据。',
  },
  {
    id: 8,
    category: 'past',
    title: '迎新活动精彩回顾',
    summary: '活动照片与参与感想的回顾版式示例。',
    content:
      '这里将展示经过授权的活动照片、活动回顾和参与感想。\n\n当前仅为页面示例，不表示该活动已经举办。',
  },
  {
    id: 9,
    category: 'past',
    title: '校园交流精彩瞬间',
    summary: '校园交流记录的回顾版式示例。',
    content:
      '这里将记录活动现场与交流收获，并链接正式回顾文章。\n\n当前尚未提供实际活动记录与图片。',
  },
  {
    id: 10,
    category: 'past',
    title: '城市探索活动回顾',
    summary: '城市探索照片与故事的回顾版式示例。',
    content: '这里将呈现活动照片与参与者的分享。\n\n这是示例内容，真实回顾与公众号原文待提供。',
  },
].map((activity) => ({
  ...activity,
  category: activity.category as ActivityDetail['category'],
  starts_at: null,
  location: '待官方公布',
  is_example: true,
  article_url: null,
}))

function toSummary(activity: ActivityDetail): ActivitySummary {
  return {
    id: activity.id,
    title: activity.title,
    summary: activity.summary,
    category: activity.category,
    starts_at: activity.starts_at,
    location: activity.location,
    is_example: activity.is_example,
  }
}

function listActivities({ query }: MockRequest): Paginated<ActivitySummary> {
  const { category, q = '', cursor } = query
  if (category && !['latest', 'news', 'past'].includes(category)) {
    throw mockError('VALIDATION_ERROR', '请选择有效的活动分类')
  }
  if (cursor && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) {
    throw mockError('VALIDATION_ERROR', '分页位置无效，请刷新重试')
  }
  const matched = activities.filter(
    (activity) =>
      (!category || activity.category === category) &&
      (includesText(activity.title, q) || includesText(activity.summary, q)),
  )
  const page = paginate(matched, cursor, 6)
  return { ...page, items: page.items.map(toSummary) }
}

function getActivity({ params }: MockRequest): ActivityDetail {
  const activity = activities.find((item) => item.id === paramNumber(params, 'id'))
  if (!activity) throw mockError('NOT_FOUND', '这条活动不存在或已下架')
  return { ...activity }
}

export const activityRoutes: MockRoute[] = [
  { method: 'GET', pattern: '/activities', handler: listActivities },
  { method: 'GET', pattern: '/activities/:id', handler: getActivity },
]
