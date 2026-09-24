import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentUser, getDb, resetDb } from '../../../../miniprogram/services/mock/db'
import type {
  Board,
  Comment,
  CreatePostBody,
  LikeResult,
  Paginated,
  PostDetail,
  PostImage,
  PostSummary,
} from '../../../../miniprogram/types/api'
import { call, errorCodeOf } from './call'

const STAFF_BOARD_ID = 6
const SECONDHAND_BOARD_ID = 1

function becomeMember(): void {
  call('POST', '/membership/email-code', { email: 'me0001@student.monash.edu' })
  call('POST', '/membership/verify', { email: 'me0001@student.monash.edu', code: '123456' })
}

function createPost(overrides: Partial<CreatePostBody> = {}): PostDetail {
  const body: CreatePostBody = {
    board_id: SECONDHAND_BOARD_ID,
    title: '出一台显示器',
    content: '27 寸，九成新，Clayton 自取。',
    image_ids: [],
    ...overrides,
  }
  return call<PostDetail>('POST', '/forum/posts', body)
}

function listPosts(
  query: Record<string, string | number | undefined> = {},
): Paginated<PostSummary> {
  return call<Paginated<PostSummary>>('GET', '/forum/posts', undefined, query)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T10:00:00+10:00'))
  resetDb()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('板块', () => {
  it('官方公告只有干事能发帖', () => {
    const boards = call<Board[]>('GET', '/forum/boards')

    expect(boards.find((board) => board.id === STAFF_BOARD_ID)).toMatchObject({
      name: '官方公告',
      staff_only: true,
    })
  })
})

describe('帖子列表', () => {
  it('置顶帖排在最前面，其余按发布时间从新到旧', () => {
    const { items } = listPosts()
    const [first, ...rest] = items
    const times = rest.map((post) => Date.parse(post.created_at))

    expect(first.is_pinned).toBe(true)
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('每页 10 条', () => {
    const first = listPosts()
    const second = listPosts({ cursor: first.next_cursor ?? undefined })

    expect(first.items).toHaveLength(10)
    expect(second.items).toHaveLength(2)
    expect(second.next_cursor).toBeNull()
  })

  it('按板块和关键词筛选', () => {
    expect(
      listPosts({ board: SECONDHAND_BOARD_ID }).items.every((post) => post.board.id === 1),
    ).toBe(true)
    expect(listPosts({ q: '电饭煲' }).items.map((post) => post.title)).toEqual([
      '出一个九成新的电饭煲',
    ])
  })

  it('author=me 只返回自己的帖子', () => {
    becomeMember()
    createPost()

    expect(listPosts({ author: 'me' }).items.map((post) => post.title)).toEqual(['出一台显示器'])
  })
})

describe('发帖', () => {
  it('不是有效会员时不能发帖', () => {
    expect(errorCodeOf(() => createPost())).toBe('MEMBERSHIP_REQUIRED')
  })

  it('禁言期内不能发帖', () => {
    becomeMember()
    currentUser(getDb()).banned_until = '2026-10-01T00:00:00+10:00'

    expect(errorCodeOf(() => createPost())).toBe('USER_BANNED')
  })

  it('普通会员不能在官方公告发帖', () => {
    becomeMember()

    expect(errorCodeOf(() => createPost({ board_id: STAFF_BOARD_ID }))).toBe('FORBIDDEN')
  })

  it('标题、正文和图片数量不合法时失败', () => {
    becomeMember()

    expect(errorCodeOf(() => createPost({ title: '  ' }))).toBe('VALIDATION_ERROR')
    expect(errorCodeOf(() => createPost({ title: '字'.repeat(51) }))).toBe('VALIDATION_ERROR')
    expect(errorCodeOf(() => createPost({ content: '' }))).toBe('VALIDATION_ERROR')
    expect(
      errorCodeOf(() => createPost({ image_ids: Array.from({ length: 10 }, (_, i) => i + 1) })),
    ).toBe('VALIDATION_ERROR')
  })

  it('含违规内容时被拦截', () => {
    becomeMember()

    expect(errorCodeOf(() => createPost({ content: '这是一条违规内容' }))).toBe('CONTENT_RISKY')
  })

  it('发布成功后排在置顶帖后面的第一位', () => {
    becomeMember()
    const post = createPost()

    const { items } = listPosts()

    expect(post.is_mine).toBe(true)
    expect(items[1].id).toBe(post.id)
  })
})

describe('图片审核', () => {
  it('不是有效会员时不能上传图片', () => {
    expect(errorCodeOf(() => call('POST', '/forum/images', { file_path: 'wxfile://a.jpg' }))).toBe(
      'MEMBERSHIP_REQUIRED',
    )
  })

  it('上传后先是审核中，5 秒后通过；审核通过前不出现在列表缩略图里', () => {
    becomeMember()
    const image = call<PostImage>('POST', '/forum/images', { file_path: 'wxfile://a.jpg' })
    const post = createPost({ image_ids: [image.id] })

    expect(image.check_status).toBe('pending')
    expect(call<PostDetail>('GET', `/forum/posts/${post.id}`).images[0].check_status).toBe(
      'pending',
    )
    expect(listPosts({ author: 'me' }).items[0].thumbnail_urls).toEqual([])

    vi.advanceTimersByTime(5000)

    expect(call<PostDetail>('GET', `/forum/posts/${post.id}`).images[0].check_status).toBe('pass')
    expect(listPosts({ author: 'me' }).items[0].thumbnail_urls).toEqual(['wxfile://a.jpg'])
  })
})

describe('点赞', () => {
  it('重复点赞只算一次，取消后恢复', () => {
    becomeMember()
    const before = call<PostDetail>('GET', '/forum/posts/2').like_count

    call('PUT', '/forum/posts/2/like')
    const liked = call<LikeResult>('PUT', '/forum/posts/2/like')
    const unliked = call<LikeResult>('DELETE', '/forum/posts/2/like')

    expect(liked).toEqual({ liked: true, like_count: before + 1 })
    expect(unliked).toEqual({ liked: false, like_count: before })
  })

  it('不是有效会员时不能点赞', () => {
    expect(errorCodeOf(() => call('PUT', '/forum/posts/2/like'))).toBe('MEMBERSHIP_REQUIRED')
  })
})

describe('评论', () => {
  it('不是有效会员时不能评论', () => {
    expect(errorCodeOf(() => call('POST', '/forum/posts/2/comments', { content: '还在吗' }))).toBe(
      'MEMBERSHIP_REQUIRED',
    )
  })

  it('评论成功后评论数加 1，并能回复某人', () => {
    becomeMember()
    const before = call<PostDetail>('GET', '/forum/posts/2').comment_count

    const comment = call<Comment>('POST', '/forum/posts/2/comments', {
      content: '还在吗',
      reply_to_user_id: 4,
    })

    expect(comment.is_mine).toBe(true)
    expect(comment.reply_to?.id).toBe(4)
    expect(call<PostDetail>('GET', '/forum/posts/2').comment_count).toBe(before + 1)
  })

  it('空评论、超过 500 字和违规内容都会失败', () => {
    becomeMember()

    expect(errorCodeOf(() => call('POST', '/forum/posts/2/comments', { content: ' ' }))).toBe(
      'VALIDATION_ERROR',
    )
    expect(
      errorCodeOf(() => call('POST', '/forum/posts/2/comments', { content: '字'.repeat(501) })),
    ).toBe('VALIDATION_ERROR')
    expect(errorCodeOf(() => call('POST', '/forum/posts/2/comments', { content: '违规' }))).toBe(
      'CONTENT_RISKY',
    )
  })

  it('评论按时间从早到晚排列', () => {
    const { items } = call<Paginated<Comment>>('GET', '/forum/posts/2/comments')
    const times = items.map((item) => Date.parse(item.created_at))

    expect(items.length).toBeGreaterThan(1)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe('删除', () => {
  it('不能删除别人的帖子和评论', () => {
    becomeMember()
    const othersComment = call<Paginated<Comment>>('GET', '/forum/posts/2/comments').items[0]

    expect(errorCodeOf(() => call('DELETE', '/forum/posts/2'))).toBe('FORBIDDEN')
    expect(errorCodeOf(() => call('DELETE', `/forum/comments/${othersComment.id}`))).toBe(
      'FORBIDDEN',
    )
  })

  it('删除自己的帖子后，列表里看不到，详情返回 NOT_FOUND', () => {
    becomeMember()
    const post = createPost()

    call('DELETE', `/forum/posts/${post.id}`)

    expect(listPosts().items.some((item) => item.id === post.id)).toBe(false)
    expect(errorCodeOf(() => call('GET', `/forum/posts/${post.id}`))).toBe('NOT_FOUND')
  })

  it('删除自己的评论后，评论数减 1', () => {
    becomeMember()
    const comment = call<Comment>('POST', '/forum/posts/2/comments', { content: '还在吗' })
    const before = call<PostDetail>('GET', '/forum/posts/2').comment_count

    call('DELETE', `/forum/comments/${comment.id}`)

    expect(call<PostDetail>('GET', '/forum/posts/2').comment_count).toBe(before - 1)
  })
})

describe('举报', () => {
  it('不是有效会员时不能举报', () => {
    expect(
      errorCodeOf(() =>
        call('POST', '/forum/reports', { target_type: 'post', target_id: 2, reason: 'ad' }),
      ),
    ).toBe('MEMBERSHIP_REQUIRED')
  })

  it('会员可以举报存在的帖子，举报不存在的内容返回 NOT_FOUND', () => {
    becomeMember()

    expect(() =>
      call('POST', '/forum/reports', { target_type: 'post', target_id: 2, reason: 'ad' }),
    ).not.toThrow()
    expect(
      errorCodeOf(() =>
        call('POST', '/forum/reports', { target_type: 'comment', target_id: 999, reason: 'other' }),
      ),
    ).toBe('NOT_FOUND')
  })
})
