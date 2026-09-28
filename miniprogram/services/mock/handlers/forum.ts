import type {
  Board,
  Comment,
  LikeResult,
  Paginated,
  PostDetail,
  PostSummary,
  ReportReason,
} from '../../../types/api'
import { currentUser, getDb, takeId, type MockDb, type MockPost } from '../db'
import {
  assertSafe,
  includesText,
  mockError,
  paginate,
  paramNumber,
  queryNumber,
  readNumber,
  readNumberArray,
  readString,
} from '../helpers'
import type { MockRequest, MockRoute } from '../router'
import { toComment, toPostDetail, toPostSummary } from '../views'
import { requireMember } from './me'

const POST_PAGE_SIZE = 10
const COMMENT_PAGE_SIZE = 20
const TITLE_MAX_LENGTH = 50
const CONTENT_MAX_LENGTH = 5000
const COMMENT_MAX_LENGTH = 500
const REPORT_REASONS: ReportReason[] = ['ad', 'porn', 'abuse', 'illegal', 'other']

function findPost(db: MockDb, params: Record<string, string>): MockPost {
  const id = paramNumber(params, 'id')
  const post = db.posts.find((item) => item.id === id && !item.deleted)
  if (
    !post ||
    (post.moderation_status !== 'approved' && post.author_id !== db.meId && !contentStaff(db))
  )
    throw mockError('NOT_FOUND', '帖子不存在或已被删除')
  return post
}

function byPinnedThenNewest(a: MockPost, b: MockPost): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
  return Date.parse(b.created_at) - Date.parse(a.created_at)
}

function listBoards(): Board[] {
  return getDb().boards.map((board) => ({ ...board }))
}

function listPosts({ query }: MockRequest): Paginated<PostSummary> {
  const db = getDb()
  const board = queryNumber(query, 'board')
  const keyword = query.q ?? ''
  const mineOnly = query.author === 'me'
  const matched = db.posts
    .filter(
      (post) =>
        !post.deleted &&
        (mineOnly ? post.author_id === db.meId : post.moderation_status === 'approved') &&
        (board === undefined || post.board_id === board) &&
        (!mineOnly || post.author_id === db.meId) &&
        (includesText(post.title, keyword) || includesText(post.content, keyword)),
    )
    .sort(byPinnedThenNewest)
  const page = paginate(matched, query.cursor, POST_PAGE_SIZE)
  return { ...page, items: page.items.map((post) => toPostSummary(db, post)) }
}

function uploadImage(): never {
  requireMember(getDb())
  throw mockError('VALIDATION_ERROR', '图片上传暂未开放，请先提交文字内容')
}

function contentStaff(db: MockDb): boolean {
  return ['owner', 'editor'].includes(currentUser(db).staff_role ?? '')
}

function requirePublished(post: MockPost): void {
  if (post.moderation_status !== 'approved')
    throw mockError('FORBIDDEN', '内容尚未公开，不能进行此操作')
}

function createPost({ body }: MockRequest): PostDetail {
  const db = getDb()
  requireMember(db)
  const board = db.boards.find((item) => item.id === readNumber(body, 'board_id'))
  if (!board) throw mockError('VALIDATION_ERROR', '请选择板块')
  if (board.staff_only && !['owner', 'editor'].includes(currentUser(db).staff_role ?? '')) {
    throw mockError('FORBIDDEN', '「官方公告」只有学生会干事可以发帖')
  }

  const title = readString(body, 'title').trim()
  const content = readString(body, 'content').trim()
  const imageIds = readNumberArray(body, 'image_ids')
  if (title.length === 0 || title.length > TITLE_MAX_LENGTH) {
    throw mockError('VALIDATION_ERROR', `标题需要 1 到 ${TITLE_MAX_LENGTH} 个字`)
  }
  if (content.length === 0 || content.length > CONTENT_MAX_LENGTH) {
    throw mockError('VALIDATION_ERROR', `正文需要 1 到 ${CONTENT_MAX_LENGTH} 个字`)
  }
  if (imageIds.length) throw mockError('VALIDATION_ERROR', '图片上传暂未开放，请先提交文字内容')
  assertSafe(title, content)

  const post: MockPost = {
    id: takeId(db),
    board_id: board.id,
    author_id: db.meId,
    title,
    content,
    moderation_status: 'pending',
    review_note: '',
    image_ids: imageIds,
    like_count: 0,
    is_pinned: false,
    created_at: new Date().toISOString(),
    deleted: false,
  }
  db.posts.push(post)
  return toPostDetail(db, post)
}

function getPost({ params }: MockRequest): PostDetail {
  const db = getDb()
  return toPostDetail(db, findPost(db, params))
}

function deletePost({ params }: MockRequest): null {
  const db = getDb()
  const post = findPost(db, params)
  if (post.author_id !== db.meId && !contentStaff(db))
    throw mockError('FORBIDDEN', '只能删除自己的帖子')
  post.deleted = true
  return null
}

function listComments({ params, query }: MockRequest): Paginated<Comment> {
  const db = getDb()
  const post = findPost(db, params)
  const comments = db.comments
    .filter(
      (comment) =>
        comment.post_id === post.id &&
        !comment.deleted &&
        (comment.moderation_status === 'approved' ||
          comment.author_id === db.meId ||
          contentStaff(db)),
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const page = paginate(comments, query.cursor, COMMENT_PAGE_SIZE)
  return { ...page, items: page.items.map((comment) => toComment(db, comment)) }
}

function createComment({ params, body }: MockRequest): Comment {
  const db = getDb()
  requireMember(db)
  const post = findPost(db, params)
  requirePublished(post)
  const content = readString(body, 'content').trim()
  if (content.length === 0 || content.length > COMMENT_MAX_LENGTH) {
    throw mockError('VALIDATION_ERROR', `评论需要 1 到 ${COMMENT_MAX_LENGTH} 个字`)
  }
  assertSafe(content)
  const replyTo = readNumber(body, 'reply_to_user_id')
  if (
    replyTo !== undefined &&
    replyTo !== post.author_id &&
    !db.comments.some(
      (item) =>
        item.post_id === post.id &&
        !item.deleted &&
        item.moderation_status === 'approved' &&
        item.author_id === replyTo,
    )
  )
    throw mockError('VALIDATION_ERROR', '回复对象不在本帖中')
  const comment = {
    id: takeId(db),
    post_id: post.id,
    author_id: db.meId,
    reply_to_user_id: replyTo ?? null,
    content,
    moderation_status: 'pending' as const,
    review_note: '',
    created_at: new Date().toISOString(),
    deleted: false,
  }
  db.comments.push(comment)
  return toComment(db, comment)
}

function deleteComment({ params }: MockRequest): null {
  const db = getDb()
  const id = paramNumber(params, 'id')
  const comment = db.comments.find((item) => item.id === id && !item.deleted)
  if (!comment) throw mockError('NOT_FOUND', '评论不存在或已被删除')
  if (comment.author_id !== db.meId && !contentStaff(db))
    throw mockError('FORBIDDEN', '只能删除自己的评论')
  comment.deleted = true
  return null
}

function setLiked(req: MockRequest, liked: boolean): LikeResult {
  const db = getDb()
  requireMember(db)
  const post = findPost(db, req.params)
  requirePublished(post)
  const already = db.likedPostIds.includes(post.id)
  if (liked && !already) {
    db.likedPostIds.push(post.id)
    post.like_count += 1
  }
  if (!liked && already) {
    db.likedPostIds = db.likedPostIds.filter((id) => id !== post.id)
    post.like_count -= 1
  }
  return { liked, like_count: post.like_count }
}

function createReport({ body }: MockRequest): null {
  const db = getDb()
  requireMember(db)
  const targetType = readString(body, 'target_type')
  const targetId = readNumber(body, 'target_id')
  const reason = REPORT_REASONS.find((item) => item === readString(body, 'reason'))
  if ((targetType !== 'post' && targetType !== 'comment') || targetId === undefined || !reason) {
    throw mockError('VALIDATION_ERROR', '请选择举报原因')
  }
  const exists =
    targetType === 'post'
      ? db.posts.some(
          (post) => post.id === targetId && !post.deleted && post.moderation_status === 'approved',
        )
      : db.comments.some(
          (comment) =>
            comment.id === targetId &&
            !comment.deleted &&
            comment.moderation_status === 'approved' &&
            db.posts.some(
              (post) =>
                post.id === comment.post_id &&
                !post.deleted &&
                post.moderation_status === 'approved',
            ),
        )
  if (!exists) throw mockError('NOT_FOUND', '举报的内容不存在或已被删除')
  if (
    db.reports.some((report) => report.target_type === targetType && report.target_id === targetId)
  )
    return null
  db.reports.push({
    target_type: targetType,
    target_id: targetId,
    reason,
    detail: readString(body, 'detail'),
  })
  return null
}

export const forumRoutes: MockRoute[] = [
  { method: 'GET', pattern: '/forum/boards', handler: listBoards },
  { method: 'GET', pattern: '/forum/posts', handler: listPosts },
  { method: 'POST', pattern: '/forum/images', handler: uploadImage },
  { method: 'POST', pattern: '/forum/posts', handler: createPost },
  { method: 'GET', pattern: '/forum/posts/:id', handler: getPost },
  { method: 'DELETE', pattern: '/forum/posts/:id', handler: deletePost },
  { method: 'GET', pattern: '/forum/posts/:id/comments', handler: listComments },
  { method: 'POST', pattern: '/forum/posts/:id/comments', handler: createComment },
  { method: 'DELETE', pattern: '/forum/comments/:id', handler: deleteComment },
  { method: 'PUT', pattern: '/forum/posts/:id/like', handler: (req) => setLiked(req, true) },
  { method: 'DELETE', pattern: '/forum/posts/:id/like', handler: (req) => setLiked(req, false) },
  { method: 'POST', pattern: '/forum/reports', handler: createReport },
]
