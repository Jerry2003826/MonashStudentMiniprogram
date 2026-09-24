import type {
  Board,
  Comment,
  LikeResult,
  Paginated,
  PostDetail,
  PostImage,
  PostSummary,
  ReportReason,
} from '../../../types/api'
import { currentUser, getDb, takeId, type MockDb, type MockImage, type MockPost } from '../db'
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
const MAX_IMAGES = 9
export const IMAGE_REVIEW_MS = 5000
const REPORT_REASONS: ReportReason[] = ['ad', 'porn', 'abuse', 'illegal', 'other']

function findPost(db: MockDb, params: Record<string, string>): MockPost {
  const id = paramNumber(params, 'id')
  const post = db.posts.find((item) => item.id === id && !item.deleted)
  if (!post) throw mockError('NOT_FOUND', '帖子不存在或已被删除')
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
        (board === undefined || post.board_id === board) &&
        (!mineOnly || post.author_id === db.meId) &&
        (includesText(post.title, keyword) || includesText(post.content, keyword)),
    )
    .sort(byPinnedThenNewest)
  const page = paginate(matched, query.cursor, POST_PAGE_SIZE)
  return { ...page, items: page.items.map((post) => toPostSummary(db, post)) }
}

function uploadImage({ body }: MockRequest): PostImage {
  const db = getDb()
  requireMember(db)
  const image: MockImage = {
    id: takeId(db),
    url: readString(body, 'file_path'),
    uploader_id: db.meId,
    check_status: 'pending',
  }
  db.images.push(image)
  setTimeout(() => {
    image.check_status = 'pass'
  }, IMAGE_REVIEW_MS)
  return { id: image.id, url: image.url, check_status: 'pending' }
}

function createPost({ body }: MockRequest): PostDetail {
  const db = getDb()
  requireMember(db)
  const board = db.boards.find((item) => item.id === readNumber(body, 'board_id'))
  if (!board) throw mockError('VALIDATION_ERROR', '请选择板块')
  if (board.staff_only && !currentUser(db).is_staff) {
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
  const ownImages = imageIds.every((id) =>
    db.images.some((image) => image.id === id && image.uploader_id === db.meId),
  )
  if (imageIds.length > MAX_IMAGES || !ownImages) {
    throw mockError('VALIDATION_ERROR', `最多上传 ${MAX_IMAGES} 张图片`)
  }
  assertSafe(title, content)

  const post: MockPost = {
    id: takeId(db),
    board_id: board.id,
    author_id: db.meId,
    title,
    content,
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
  if (post.author_id !== db.meId) throw mockError('FORBIDDEN', '只能删除自己的帖子')
  post.deleted = true
  return null
}

function listComments({ params, query }: MockRequest): Paginated<Comment> {
  const db = getDb()
  const post = findPost(db, params)
  const comments = db.comments
    .filter((comment) => comment.post_id === post.id && !comment.deleted)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const page = paginate(comments, query.cursor, COMMENT_PAGE_SIZE)
  return { ...page, items: page.items.map((comment) => toComment(db, comment)) }
}

function createComment({ params, body }: MockRequest): Comment {
  const db = getDb()
  requireMember(db)
  const post = findPost(db, params)
  const content = readString(body, 'content').trim()
  if (content.length === 0 || content.length > COMMENT_MAX_LENGTH) {
    throw mockError('VALIDATION_ERROR', `评论需要 1 到 ${COMMENT_MAX_LENGTH} 个字`)
  }
  assertSafe(content)
  const replyTo = readNumber(body, 'reply_to_user_id')
  const comment = {
    id: takeId(db),
    post_id: post.id,
    author_id: db.meId,
    reply_to_user_id: replyTo ?? null,
    content,
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
  if (comment.author_id !== db.meId) throw mockError('FORBIDDEN', '只能删除自己的评论')
  comment.deleted = true
  return null
}

function setLiked(req: MockRequest, liked: boolean): LikeResult {
  const db = getDb()
  requireMember(db)
  const post = findPost(db, req.params)
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
      ? db.posts.some((post) => post.id === targetId && !post.deleted)
      : db.comments.some((comment) => comment.id === targetId && !comment.deleted)
  if (!exists) throw mockError('NOT_FOUND', '举报的内容不存在或已被删除')
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
